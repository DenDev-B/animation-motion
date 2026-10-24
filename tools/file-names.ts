export function safeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[ .]+$/g, '');
}

export function formatFileToken(format: '16:9' | '9:16'): '16x9' | '9x16' {
  return format === '16:9' ? '16x9' : '9x16';
}
