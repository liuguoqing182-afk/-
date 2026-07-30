#!/usr/bin/env python3
"""Build one labeled AIMirror screenshot report with template-search verdicts."""
from __future__ import annotations
import argparse
import json
import re
from collections import OrderedDict
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH = 1600
MARGIN = 44
GAP = 16
BG = '#171717'
PANEL = '#222222'
DIVIDER = '#363636'
WHITE = '#F5F5F5'
SECONDARY = '#B8B8B8'
ACCENT = '#3DDC84'
VERDICT_COLORS = {
    'PASS': '#3DDC84',
    'FAIL': '#FF5D68',
    'ERROR': '#FFB547',
    'NOT_EVALUATED': '#B8B8B8',
}
VERDICT_LABELS = {
    'PASS': '通过',
    'FAIL': '不通过',
    'ERROR': '执行异常',
    'NOT_EVALUATED': '未自动判断',
}
COLORS = {
    '模版修改': '#A970FF',
    '新首页配置': '#47A7FF',
    'More Style Video配置': '#FF9F43',
    'More Style AI Filter配置': '#F15BB5',
}

def get_font(size: int, bold: bool = False):
    choices = [
        Path('C:/Windows/Fonts/simhei.ttf'),
        Path('C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf'),
    ]
    for choice in choices:
        if choice.exists():
            return ImageFont.truetype(str(choice), size=size)
    return ImageFont.load_default()

F_TITLE = get_font(46, True)
F_SUB = get_font(26)
F_META = get_font(23)
F_MODULE = get_font(31, True)
F_OBJECT = get_font(26, True)
F_LABEL = get_font(20)

def args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execution', action='append', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--operator', default='')
    parser.add_argument('--release', default='DEV → PRO')
    parser.add_argument('--app-version', default='')
    parser.add_argument('--message-id', default='')
    return parser.parse_args()

def safe_file_segment(value: str):
    return re.sub(r'[^0-9A-Za-z._-]+', '_', str(value or '')).strip('_')[:80] or 'task'

def ensure_incomplete_screenshot(execution_path: Path, task: dict, shots: list[dict]):
    if shots:
        return shots
    raw_dir = execution_path.parent / 'raw-screenshots'
    raw_dir.mkdir(parents=True, exist_ok=True)
    placeholder = raw_dir / f'{safe_file_segment(task.get("objectName"))}_incomplete_placeholder.png'
    if not placeholder.exists():
        image = Image.new('RGB', (1080, 2400), '#242424')
        draw = ImageDraw.Draw(image)
        draw.text((80, 220), '截图未完成', fill=VERDICT_COLORS['ERROR'], font=get_font(56, True))
        draw.text((80, 330), f'{task.get("module", "")}｜{task.get("objectName", "")}', fill=WHITE, font=get_font(34, True))
        reason = task.get('verdictReason') or task.get('finalError') or '未能保留手机异常现场截图'
        draw.multiline_text((80, 450), f'原因：{reason}', fill=SECONDARY, font=get_font(30), spacing=18)
        image.save(placeholder, optimize=True)
    total = int(task.get('screenshotTotal') or 1)
    return [{
        'sequence': 0,
        'total': total,
        'label': f'{task.get("module", "")}｜{task.get("objectName", "")}｜0/{total}截图｜截图未完成',
        'path': str(placeholder),
        'incomplete': True,
    }]

def task_priority(task: dict):
    return 2 if task.get('executionState') == 'SCREENSHOTS_CAPTURED' else 1

def load_tasks(paths: list[str]):
    task_map = OrderedDict()
    for execution_name in paths:
        execution_path = Path(execution_name)
        execution = json.loads(execution_path.read_text(encoding='utf-8-sig'))
        for task in execution.get('taskResults', []):
            state = task.get('executionState')
            if state not in {'SCREENSHOTS_CAPTURED', 'SCREENSHOT_INCOMPLETE'}:
                continue
            shots = sorted(task.get('screenshots', []), key=lambda item: item['sequence'])
            if state == 'SCREENSHOTS_CAPTURED' and len(shots) != task['screenshotTotal']:
                key = (task['module'], task['objectName'])
                raise ValueError(f'{key}: expected {task["screenshotTotal"]}, got {len(shots)}')
            if state == 'SCREENSHOT_INCOMPLETE':
                shots = ensure_incomplete_screenshot(execution_path, task, shots)
            for shot in shots:
                if not Path(shot['path']).is_file():
                    raise FileNotFoundError(shot['path'])
            key = (task['module'], task['objectName'])
            candidate = {
                'module': task['module'],
                'objectName': task['objectName'],
                'screenshots': shots,
                'executionState': state,
                'attemptCount': len(task.get('attempts', [])),
                'businessVerdict': task.get('businessVerdict', 'NOT_EVALUATED'),
                'verdictReasonCode': task.get('verdictReasonCode') or '',
                'verdictReason': task.get('verdictReason') or task.get('finalError') or '',
                'detectedModelName': (task.get('evidence') or {}).get('firstResultTitle') or '',
                'modelAssertions': task.get('modelAssertions') or (task.get('evidence') or {}).get('expectedModels') or [],
                'evidence': task.get('evidence') or {},
            }
            previous = task_map.get(key)
            if previous is None or task_priority(candidate) >= task_priority(previous):
                task_map[key] = candidate
    return list(task_map.values())
def verdict_summary(tasks):
    counts = {'PASS': 0, 'FAIL': 0, 'ERROR': 0}
    for task in tasks:
        verdict = task.get('businessVerdict')
        if verdict in counts:
            counts[verdict] += 1
    return counts

def screenshot_summary(tasks):
    return {
        'taskCount': len(tasks),
        'completed': sum(task.get('executionState') == 'SCREENSHOTS_CAPTURED' for task in tasks),
        'incomplete': sum(task.get('executionState') == 'SCREENSHOT_INCOMPLETE' for task in tasks),
        'screenshotCount': sum(len(task['screenshots']) for task in tasks),
    }

def humanize_reason(reason: str):
    reason = str(reason or '').strip()
    if reason == 'aiAction timed out after 180000ms':
        return '自动化操作等待180秒仍未完成'
    return reason or '未记录具体原因'

def problem_entries(tasks):
    entries = []
    for task in tasks:
        identity = f'{task["module"]}｜{task["objectName"]}'
        if task.get('executionState') == 'SCREENSHOT_INCOMPLETE':
            retries = max(0, int(task.get('attemptCount') or 0) - 1)
            retry_text = f'已补跑{retries}次仍失败' if retries else '首次执行失败'
            entries.append(f'{identity}：截图未完成；{retry_text}；原因：{humanize_reason(task.get("verdictReason"))}')
        elif task.get('businessVerdict') == 'FAIL':
            entries.append(f'{identity}：不通过；{humanize_reason(task.get("verdictReason"))}')
        elif task.get('businessVerdict') == 'ERROR':
            entries.append(f'{identity}：执行异常；原因：{humanize_reason(task.get("verdictReason"))}')
    return entries

def grouped(tasks):
    result = OrderedDict()
    for task in tasks:
        result.setdefault(task['module'], []).append(task)
    return result

def shot_height(path: str, width: int):
    with Image.open(path) as image:
        return round(width * image.height / image.width)

def fit_font(draw, text: str, max_width: int):
    for size in range(20, 13, -1):
        candidate = get_font(size)
        if draw.textbbox((0, 0), text, font=candidate)[2] <= max_width:
            return candidate
    return get_font(14)

def shorten(text: str, limit: int = 34):
    text = str(text or '').strip()
    return text if len(text) <= limit else text[:limit - 1] + '…'

def model_reference(item: dict):
    name = str(item.get('name') or item.get('expectedName') or '名称未解析')
    model_id = str(item.get('id') or '').strip()
    return f'{name}({model_id})' if model_id else name

def tag_model_comparison(task: dict):
    assertions = task.get('modelAssertions') or []
    evidence = task.get('evidence') or {}
    if not assertions and evidence.get('evidenceType') != 'TAG_MODEL_NAME_SCAN':
        return None
    incomplete = task.get('executionState') == 'SCREENSHOT_INCOMPLETE'
    expected = [
        {
            'id': item.get('id'),
            'name': item.get('name'),
            'expectedState': item.get('expectedState'),
        }
        for item in assertions
    ]
    actual = list(evidence.get('actualModelNames') or [])
    found = list(evidence.get('foundModelNames') or [])
    missing = list(evidence.get('missingModels') or [])
    unexpectedly_present = list(evidence.get('unexpectedlyPresentModels') or [])
    unresolved = list(evidence.get('unresolvedModels') or [])
    return {
        'module': task.get('module'),
        'objectName': task.get('objectName'),
        'executionIncomplete': incomplete,
        'expectedModels': expected,
        'actualModelNames': actual,
        'foundModelNames': found,
        'missingModels': missing,
        'unexpectedlyPresentModels': unexpectedly_present,
        'unresolvedModels': unresolved,
        'comparisons': list(evidence.get('comparisons') or []),
        'actualNameCollectionComplete': evidence.get('actualNameCollectionComplete'),
        'actualNameCollectionWarnings': list(evidence.get('actualNameCollectionWarnings') or []),
    }

def expected_state_label(item: dict):
    state = item.get('expectedState')
    if state == 'PRESENT':
        return '应存在'
    if state == 'ABSENT':
        return '应删除'
    return '状态异常'

def tag_model_rows(task: dict):
    comparison = tag_model_comparison(task)
    if comparison is None:
        return []
    expected = comparison['expectedModels']
    expected_text = '、'.join(
        f'{model_reference(item)}[{expected_state_label(item)}]'
        for item in expected
    ) or '无'
    if comparison['executionIncomplete']:
        actual_text = '执行未完成，无法可靠读取'
        found_text = '未判定'
        missing_text = '未判定（执行异常不等同于模型缺失）'
    else:
        actual_text = '、'.join(comparison['actualModelNames']) or '未读取到模型卡片名称'
        found_text = '、'.join(comparison['foundModelNames']) or '无'
        missing_text = '、'.join(model_reference(item) for item in comparison['missingModels']) or '无'
    rows = [
        ('预期名称', expected_text, WHITE),
        ('页面实际名称', actual_text, SECONDARY),
        ('实际找到', found_text, ACCENT if comparison['foundModelNames'] else SECONDARY),
        ('缺失名称', missing_text, VERDICT_COLORS['FAIL'] if comparison['missingModels'] else SECONDARY),
    ]
    if comparison['unexpectedlyPresentModels']:
        rows.append((
            '应删除仍存在',
            '、'.join(model_reference(item) for item in comparison['unexpectedlyPresentModels']),
            VERDICT_COLORS['FAIL'],
        ))
    if comparison['unresolvedModels']:
        rows.append((
            '无法解析',
            '、'.join(model_reference(item) for item in comparison['unresolvedModels']),
            VERDICT_COLORS['ERROR'],
        ))
    warnings = comparison['actualNameCollectionWarnings']
    if warnings:
        rows.append(('名称读取告警', '；'.join(warnings), VERDICT_COLORS['ERROR']))
    return rows

def wrapped_tag_model_lines(draw, task: dict, width: int):
    lines = []
    for label, value, color in tag_model_rows(task):
        wrapped = wrap_text(draw, f'{label}：{value}', F_META, width - 36)
        lines.extend((line, color) for line in wrapped)
    return lines

def tag_model_panel_height(task: dict, width: int):
    measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    lines = wrapped_tag_model_lines(measure, task, width)
    return 0 if not lines else 88 + len(lines) * 32

def draw_tag_model_panel(canvas, draw, task: dict, x: int, y: int, width: int):
    lines = wrapped_tag_model_lines(draw, task, width)
    if not lines:
        return 0
    height = 88 + len(lines) * 32
    draw.rounded_rectangle((x, y, x + width, y + height), radius=12, fill=PANEL, outline=DIVIDER, width=2)
    draw.text((x + 18, y + 14), '模型名称对齐明细', fill=WHITE, font=F_SUB)
    line_y = y + 60
    for line, color in lines:
        draw.text((x + 18, line_y), line, fill=color, font=F_META)
        line_y += 32
    return height

def total_height(groups, header_height):
    height = header_height
    usable = WIDTH - 2 * MARGIN
    for module_tasks in groups.values():
        height += 70
        if all(
            len(task['screenshots']) == 1 and not tag_model_rows(task)
            for task in module_tasks
        ):
            columns = min(6, len(module_tasks))
            panel_width = (usable - GAP * (columns - 1)) // columns
            rows = (len(module_tasks) + columns - 1) // columns
            image_height = max(shot_height(task['screenshots'][0]['path'], panel_width) for task in module_tasks)
            height += rows * (image_height + 100) + (rows - 1) * GAP + 28
        else:
            for task in module_tasks:
                count = len(task['screenshots'])
                image_width = min(330, (usable - GAP * (count - 1)) // count)
                image_height = max(shot_height(shot['path'], image_width) for shot in task['screenshots'])
                detail_height = tag_model_panel_height(task, usable)
                height += 48 + image_height + 58 + detail_height + 26
        height += 22
    return height

def draw_shot(canvas, draw, shot, x: int, y: int, width: int, label_color=ACCENT):
    with Image.open(shot['path']) as source:
        source = source.convert('RGB')
        height = round(width * source.height / source.width)
        source = source.resize((width, height), Image.Resampling.LANCZOS)
        canvas.paste(source, (x, y))
    draw.rounded_rectangle((x - 1, y - 1, x + width, y + height), radius=8, outline=DIVIDER, width=2)
    label_font = fit_font(draw, shot['label'], width)
    draw.text((x + 2, y + height + 13), shot['label'], fill=label_color, font=label_font)
    return height

def wrap_text(draw, text: str, font, max_width: int):
    lines, current = [], ''
    for character in str(text):
        candidate = current + character
        if current and draw.textbbox((0, 0), candidate, font=font)[2] > max_width:
            lines.append(current)
            current = character
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or ['']

def render(options, tasks):
    groups = grouped(tasks)
    stats = screenshot_summary(tasks)
    verdicts = verdict_summary(tasks)
    problems = problem_entries(tasks)
    measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    wrapped_problems = []
    for index, problem in enumerate(problems, start=1):
        wrapped_problems.extend(wrap_text(measure, f'{index}. {problem}', F_META, WIDTH - 2 * MARGIN - 20))
    header_height = 350
    if wrapped_problems:
        header_height = 380 + len(wrapped_problems) * 32
    canvas = Image.new('RGB', (WIDTH, total_height(groups, header_height)), BG)
    draw = ImageDraw.Draw(canvas)
    draw.text((MARGIN, 34), 'AIMirror 首屏配置自动化截图报告', fill=WHITE, font=F_TITLE)
    verdict_text = f'自动判断：通过 {verdicts["PASS"]}｜不通过 {verdicts["FAIL"]}｜执行异常 {verdicts["ERROR"]}'
    verdict_fill = VERDICT_COLORS['FAIL'] if verdicts['FAIL'] else (VERDICT_COLORS['ERROR'] if verdicts['ERROR'] else ACCENT)
    draw.text((MARGIN, 100), verdict_text, fill=verdict_fill, font=F_TITLE)
    screenshot_text = (
        f'截图任务：{stats["taskCount"]} 个配置对象｜完成 {stats["completed"]}｜'
        f'未完成 {stats["incomplete"]}｜报告截图 {stats["screenshotCount"]} 张'
    )
    draw.text((MARGIN, 162), screenshot_text, fill=ACCENT, font=F_SUB)
    meta = f'操作人：{options.operator or "—"}    发布环境：{options.release}    APP：{options.app_version or "—"}'
    draw.text((MARGIN, 208), meta, fill=SECONDARY, font=F_META)
    draw.text((MARGIN, 249), '说明：模板及标签模型名称自动比对；单项失败不阻断总图；异常现场标注“截图未完成”。', fill=SECONDARY, font=F_META)
    if options.message_id:
        draw.text((MARGIN, 290), f'message_id：{options.message_id}', fill='#777777', font=get_font(18))
    if wrapped_problems:
        draw.text((MARGIN, 326), '问题摘要（不阻断总图输出）', fill=VERDICT_COLORS['ERROR'], font=F_SUB)
        problem_y = 364
        for line in wrapped_problems:
            draw.text((MARGIN + 14, problem_y), line, fill=WHITE, font=F_META)
            problem_y += 32

    y = header_height
    usable = WIDTH - 2 * MARGIN
    for module, module_tasks in groups.items():
        color = COLORS.get(module, '#BBBBBB')
        draw.rectangle((MARGIN, y + 8, MARGIN + 8, y + 47), fill=color)
        module_count = sum(len(task['screenshots']) for task in module_tasks)
        draw.text((MARGIN + 22, y), f'{module}  ·  {module_count} 张', fill=WHITE, font=F_MODULE)
        y += 70
        if all(
            len(task['screenshots']) == 1 and not tag_model_rows(task)
            for task in module_tasks
        ):
            columns = min(6, len(module_tasks))
            panel_width = (usable - GAP * (columns - 1)) // columns
            for start in range(0, len(module_tasks), columns):
                row = module_tasks[start:start + columns]
                row_height = 0
                for column, task in enumerate(row):
                    x = MARGIN + column * (panel_width + GAP)
                    expected_height = shot_height(task['screenshots'][0]['path'], panel_width)
                    draw.rounded_rectangle((x - 8, y - 8, x + panel_width + 8, y + expected_height + 88), radius=12, fill=PANEL)
                    verdict = task.get('businessVerdict', 'NOT_EVALUATED')
                    label_color = VERDICT_COLORS.get(verdict, ACCENT) if verdict != 'NOT_EVALUATED' else ACCENT
                    shot_height_value = draw_shot(canvas, draw, task['screenshots'][0], x, y, panel_width, label_color)
                    row_height = max(row_height, shot_height_value)
                    reason = shorten(task.get('verdictReason') or VERDICT_LABELS.get(verdict, verdict))
                    detail_font = fit_font(draw, reason, panel_width)
                    draw.text(
                        (x + 2, y + shot_height_value + 43),
                        reason,
                        fill=VERDICT_COLORS.get(verdict, SECONDARY),
                        font=detail_font,
                    )
                y += row_height + 100 + GAP
            y += 12
        else:
            for task in module_tasks:
                shots = task['screenshots']
                image_width = min(330, (usable - GAP * (len(shots) - 1)) // len(shots))
                content_width = image_width * len(shots) + GAP * (len(shots) - 1)
                start_x = MARGIN + (usable - content_width) // 2
                task_suffix = '｜截图未完成' if task.get('executionState') == 'SCREENSHOT_INCOMPLETE' else ''
                draw.text((MARGIN, y), f'{task["module"]}｜{task["objectName"]}｜{len(shots)} 张{task_suffix}', fill=color, font=F_OBJECT)
                y += 48
                row_height = 0
                verdict = task.get('businessVerdict', 'NOT_EVALUATED')
                label_color = VERDICT_COLORS.get(verdict, ACCENT) if verdict != 'NOT_EVALUATED' else ACCENT
                for index, shot in enumerate(shots):
                    x = start_x + index * (image_width + GAP)
                    row_height = max(row_height, draw_shot(canvas, draw, shot, x, y, image_width, label_color))
                y += row_height + 58
                y += draw_tag_model_panel(canvas, draw, task, MARGIN, y, usable)
                y += 26
        draw.line((MARGIN, y, WIDTH - MARGIN, y), fill=DIVIDER, width=2)
        y += 22

    output = Path(options.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.suffix.lower() in {'.jpg', '.jpeg'}:
        canvas.save(output, quality=91, optimize=True, subsampling=0)
    else:
        canvas.save(output, optimize=True)
    return output
def main():
    options = args()
    tasks = load_tasks(options.execution)
    if not tasks:
        raise SystemExit('No completed screenshot tasks found')
    output = render(options, tasks)
    stats = screenshot_summary(tasks)
    result = {
        'output': str(output),
        'taskCount': stats['taskCount'],
        'completedTaskCount': stats['completed'],
        'incompleteTaskCount': stats['incomplete'],
        'screenshotCount': stats['screenshotCount'],
        'businessVerdicts': verdict_summary(tasks),
        'problems': problem_entries(tasks),
        'tagModelComparisons': [
            comparison
            for task in tasks
            if (comparison := tag_model_comparison(task)) is not None
        ],
        'bytes': output.stat().st_size,
    }
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
