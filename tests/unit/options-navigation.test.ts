import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeOptionsNavigation,
  type SectionObserverFactory,
} from '../../src/ui/options-navigation';

function fixture(): void {
  document.body.innerHTML = [
    '<nav>',
    '<a href="#overview" data-section-link="overview">概览</a>',
    '<a href="#built-in" data-section-link="built-in">内置规则</a>',
    '</nav>',
    '<section id="overview"></section>',
    '<section id="built-in"></section>',
  ].join('');
}

describe('options section navigation', () => {
  beforeEach(fixture);

  it('observes each section and selects the most visible entry', () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const observe = vi.fn();
    const disconnect = vi.fn();
    const createObserver: SectionObserverFactory = (next) => {
      callbacks.push(next);
      return { observe, disconnect };
    };
    const dispose = initializeOptionsNavigation(document, createObserver);
    const overview = document.querySelector('#overview') as Element;
    const builtIn = document.querySelector('#built-in') as Element;

    expect(observe).toHaveBeenCalledWith(overview);
    expect(observe).toHaveBeenCalledWith(builtIn);
    expect(document.querySelector('[data-section-link="overview"]')?.getAttribute('aria-current'))
      .toBe('location');

    callbacks[0]!([
      { target: overview, isIntersecting: true, intersectionRatio: 0.2 },
      { target: builtIn, isIntersecting: true, intersectionRatio: 0.8 },
    ] as IntersectionObserverEntry[], {} as IntersectionObserver);

    expect(document.querySelector('[data-section-link="overview"]')?.hasAttribute('aria-current'))
      .toBe(false);
    expect(document.querySelector('[data-section-link="built-in"]')?.getAttribute('aria-current'))
      .toBe('location');

    dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('updates selection immediately on a section-link click', () => {
    const createObserver: SectionObserverFactory = () => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    });
    initializeOptionsNavigation(document, createObserver);

    (document.querySelector('[data-section-link="built-in"]') as HTMLAnchorElement).click();

    expect(document.querySelector('[data-section-link="built-in"]')?.getAttribute('aria-current'))
      .toBe('location');
  });

  it('keeps the most visible section selected across partial observer callbacks', () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const createObserver: SectionObserverFactory = (next) => {
      callbacks.push(next);
      return { observe: vi.fn(), disconnect: vi.fn() };
    };
    initializeOptionsNavigation(document, createObserver);
    const overview = document.querySelector('#overview') as Element;
    const builtIn = document.querySelector('#built-in') as Element;

    callbacks[0]!([
      { target: overview, isIntersecting: true, intersectionRatio: 0.8 },
      { target: builtIn, isIntersecting: true, intersectionRatio: 0.2 },
    ] as IntersectionObserverEntry[], {} as IntersectionObserver);
    callbacks[0]!([
      { target: builtIn, isIntersecting: true, intersectionRatio: 0.3 },
    ] as IntersectionObserverEntry[], {} as IntersectionObserver);

    expect(document.querySelector('[data-section-link="overview"]')?.getAttribute('aria-current'))
      .toBe('location');

    callbacks[0]!([
      { target: overview, isIntersecting: false, intersectionRatio: 0 },
    ] as IntersectionObserverEntry[], {} as IntersectionObserver);

    expect(document.querySelector('[data-section-link="built-in"]')?.getAttribute('aria-current'))
      .toBe('location');
  });

  it('selects the final section when scrolling reaches the document end', () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const createObserver: SectionObserverFactory = (next) => {
      callbacks.push(next);
      return { observe: vi.fn(), disconnect: vi.fn() };
    };
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 600 });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 1500,
    });
    const dispose = initializeOptionsNavigation(document, createObserver);
    const overview = document.querySelector('#overview') as Element;
    const builtIn = document.querySelector('#built-in') as Element;

    window.dispatchEvent(new Event('scroll'));
    callbacks[0]!([
      { target: overview, isIntersecting: true, intersectionRatio: 0.8 },
      { target: builtIn, isIntersecting: false, intersectionRatio: 0 },
    ] as IntersectionObserverEntry[], {} as IntersectionObserver);

    expect(document.querySelector('[data-section-link="built-in"]')?.getAttribute('aria-current'))
      .toBe('location');
    dispose();

    const overviewLink = document.querySelector('[data-section-link="overview"]')!;
    overviewLink.setAttribute('aria-current', 'location');
    document.querySelector('[data-section-link="built-in"]')?.removeAttribute('aria-current');
    window.dispatchEvent(new Event('scroll'));

    expect(overviewLink.getAttribute('aria-current')).toBe('location');
  });
});
