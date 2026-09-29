#!/usr/bin/env python3
"""Собирает самодостаточные версии макетов (инлайн CSS, без html/head/body) для публикации как Artifact."""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'mockups' / 'dist'
out.mkdir(parents=True, exist_ok=True)
tokens = (root / 'public/css/tokens.css').read_text()
crm = (root / 'public/css/crm.css').read_text()
crm = crm.replace('body { margin: 0; min-height: 100%;', '.crm-root { min-height: 100vh;')
crm = crm.replace('html { font-size: var(--root-font-size); height: 100%; }', 'body { margin: 0; }')
for name in ('channels', 'agent', 'lead'):
    src = (root / 'mockups' / f'{name}.html').read_text()
    title = re.search(r'<title>(.*?)</title>', src).group(1)
    body = re.search(r'<body>(.*)</body>', src, re.S).group(1)
    fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">'
    html = f'<title>{title}</title>\n{fonts}\n<style>\n{tokens}\n{crm}\n</style>\n<div class="crm-root" data-theme="app">{body}</div>\n'
    (out / f'{name}.html').write_text(html)
    print(out / f'{name}.html', len(html))
