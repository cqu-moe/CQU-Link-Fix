interface SectionObserver {
  observe: (target: Element) => void;
  disconnect: () => void;
}

export type SectionObserverFactory = (
  callback: IntersectionObserverCallback,
) => SectionObserver;

function defaultObserverFactory(callback: IntersectionObserverCallback): SectionObserver {
  return new IntersectionObserver(callback, {
    rootMargin: '-96px 0px -55% 0px',
    threshold: [0.15, 0.35, 0.6, 0.85],
  });
}

export function initializeOptionsNavigation(
  root: Document,
  createObserver: SectionObserverFactory = defaultObserverFactory,
): () => void {
  const links = Array.from(
    root.querySelectorAll<HTMLAnchorElement>('[data-section-link]'),
  );
  const targets: Element[] = links.flatMap((link) => {
    const id = link.dataset.sectionLink;
    const target = id ? root.getElementById(id) : null;
    return target ? [target] : [];
  });
  if (links.length === 0 || targets.length === 0) return () => {};

  const select = (id: string): void => {
    for (const link of links) {
      if (link.dataset.sectionLink === id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  select(targets[0]!.id);

  const onClick = (event: Event): void => {
    const link = event.currentTarget;
    if (link instanceof HTMLAnchorElement && link.dataset.sectionLink) {
      select(link.dataset.sectionLink);
    }
  };
  for (const link of links) link.addEventListener('click', onClick);

  const view = root.defaultView;
  const selectFinalSectionAtScrollEnd = (): boolean => {
    if (!view) return false;
    const maximumScroll = root.documentElement.scrollHeight - view.innerHeight;
    const finalTarget = targets.at(-1);
    if (maximumScroll > 0 && view.scrollY >= maximumScroll - 1 && finalTarget) {
      select(finalTarget.id);
      return true;
    }
    return false;
  };

  const visibilityByTarget = new Map(
    targets.map((target) => [target, { isIntersecting: false, intersectionRatio: 0 }]),
  );
  const observer = createObserver((entries) => {
    for (const entry of entries) {
      if (visibilityByTarget.has(entry.target)) {
        visibilityByTarget.set(entry.target, {
          isIntersecting: entry.isIntersecting,
          intersectionRatio: entry.intersectionRatio,
        });
      }
    }
    if (selectFinalSectionAtScrollEnd()) return;
    const winner = Array.from(visibilityByTarget.entries())
      .filter(([, state]) => state.isIntersecting)
      .sort(([, left], [, right]) => right.intersectionRatio - left.intersectionRatio)[0]?.[0];
    if (winner instanceof HTMLElement) {
      select(winner.id);
    }
  });
  for (const target of targets) observer.observe(target);

  view?.addEventListener('scroll', selectFinalSectionAtScrollEnd, { passive: true });

  return () => {
    observer.disconnect();
    for (const link of links) link.removeEventListener('click', onClick);
    view?.removeEventListener('scroll', selectFinalSectionAtScrollEnd);
  };
}
