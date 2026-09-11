/** Promise-based file picker using a hidden <input type="file">. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    }, { once: true });
    // Cancel / dismiss often fires window focus without a change event.
    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!input.isConnected) return;
        cleanup();
        resolve(null);
      }, 300);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
