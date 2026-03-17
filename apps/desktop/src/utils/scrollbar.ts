const SCROLLBAR_VISIBLE_CLASS = "scrollbar-visible";
const SCROLLBAR_VISIBLE_DURATION_MS = 1000;

const hideTimers = new WeakMap<HTMLElement, number>();

const markScrollbarVisible = (element: HTMLElement) => {
  element.classList.add(SCROLLBAR_VISIBLE_CLASS);

  const existingTimer = hideTimers.get(element);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    element.classList.remove(SCROLLBAR_VISIBLE_CLASS);
    hideTimers.delete(element);
  }, SCROLLBAR_VISIBLE_DURATION_MS);

  hideTimers.set(element, timer);
};

const findScrollableElement = (start: HTMLElement | null): HTMLElement | null => {
  let current: HTMLElement | null = start;

  while (current && current !== document.body) {
    if (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
};

export const setupScrollbarAutoVisibility = () => {
  const onScroll = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const scrollable = findScrollableElement(target);
    if (scrollable) {
      markScrollbarVisible(scrollable);
    }
  };

  document.addEventListener("scroll", onScroll, true);
};
