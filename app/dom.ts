/* DOM helpers. Bridge data only ever reaches the page as text (no innerHTML). */

export type Child = Node | string | number | false | null | undefined | readonly Child[];

type Attribute = string | number | boolean | null | undefined;

/**
 * Element properties: `class`, `text`, `style` (custom properties and styles),
 * `trustedHtml` (static strings from STRINGS only) and attributes. null, undefined and
 * false leave an attribute out; true sets it empty.
 */
export interface Props {
  readonly [name: string]: Attribute | Readonly<Record<string, string>>;
}

export function isList(c: Child): c is readonly Child[] {
  return Array.isArray(c);
}

export function add(el: Node, c: Child): void {
  if (c === null || c === undefined || c === false) {
    return;
  }
  if (isList(c)) {
    for (const x of c) {
      add(el, x);
    }
    return;
  }
  if (typeof c === 'string' || typeof c === 'number') {
    el.appendChild(document.createTextNode(String(c)));
    return;
  }
  el.appendChild(c);
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) {
      continue;
    }
    if (k === 'class') {
      el.className = String(v);
    } else if (k === 'text') {
      el.textContent = String(v);
    } else if (k === 'trustedHtml') {
      el.innerHTML = String(v);
    } else if (k === 'style') {
      if (typeof v === 'object') {
        for (const [name, value] of Object.entries(v)) {
          el.style.setProperty(name, value);
        }
      }
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    add(el, c);
  }
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';

/** An icon from the page's inline sprite (#i-<name>). */
export function icon(name: string, cls?: string): SVGSVGElement {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', `icon${cls ? ` ${cls}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

export function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** An element of the page shell (index.html), which is always there. */
export function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Own TV: #${id} is missing from index.html`);
  }
  return el;
}

/** The HTML elements in `scope` matching `selector`, in document order. */
export function htmlAll(scope: ParentNode, selector: string): HTMLElement[] {
  return Array.from(scope.querySelectorAll(selector)).filter((el) => el instanceof HTMLElement);
}
