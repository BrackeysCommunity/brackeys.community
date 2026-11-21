type Child = Node | string | null | undefined | false;

interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Record<string, (ev: Event) => void>;
}

/** One element, built in a line. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, f] of Object.entries(props.on ?? {})) node.addEventListener(k, f);
  for (const c of children) if (c) node.append(c);
  return node;
}

/** A button that does one thing. `main` marks the one action a view leads with. */
export function button(
  label: string,
  press: () => void,
  opts: { main?: boolean; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = el("button", { class: opts.main ? "btn btn-main" : "btn", text: label });
  b.type = "button";
  b.disabled = Boolean(opts.disabled);
  b.addEventListener("click", press);
  return b;
}

/** A flat panel with a stencilled heading. */
export function panel(heading: string, ...children: Child[]): HTMLElement {
  return el("section", { class: "panel" }, el("h2", { text: heading }), ...children);
}

export function lines(...texts: (string | null | undefined | false)[]): HTMLElement[] {
  return texts.filter((t): t is string => Boolean(t)).map((t) => el("p", { text: t }));
}
