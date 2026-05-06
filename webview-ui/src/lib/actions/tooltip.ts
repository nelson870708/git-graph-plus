export function tooltip(node: HTMLElement, text: string | undefined) {
  let el: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let mouseX = 0;
  let mouseY = 0;

  function onMouseMove(e: MouseEvent) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (el) {
      el.style.left = `${mouseX + 8}px`;
      el.style.top = `${mouseY + 14}px`;
    }
  }

  function show(e: MouseEvent) {
    if (!text) return;
    mouseX = e.clientX;
    mouseY = e.clientY;
    timer = setTimeout(() => {
      el = document.createElement('div');
      el.className = 'vsg-tooltip';
      el.textContent = text;
      document.body.appendChild(el);
      el.style.left = `${mouseX + 8}px`;
      el.style.top = `${mouseY + 14}px`;
    }, 500);
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    el?.remove();
    el = null;
  }

  node.addEventListener('mouseenter', show);
  node.addEventListener('mousemove', onMouseMove);
  node.addEventListener('mouseleave', hide);

  return {
    update(t: string | undefined) {
      text = t;
      if (el) el.textContent = t ?? '';
    },
    destroy() {
      hide();
      node.removeEventListener('mouseenter', show);
      node.removeEventListener('mousemove', onMouseMove);
      node.removeEventListener('mouseleave', hide);
    }
  };
}
