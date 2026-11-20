/**
 * A modal as the raw JSON an interaction shows; like messages, it needs
 * no discord.js.
 */

/** A form of text inputs the bot answers through its custom id. */
export interface Modal {
  customId: string;
  title: string;
  inputs: ModalInput[];
}

export interface ModalInput {
  id: string;
  label: string;
  max: number;
  /** A paragraph rather than one line. */
  long?: boolean;
  required: boolean;
}

const ROW = 1;
const TEXT_INPUT = 4;
const STYLE = { short: 1, paragraph: 2 } as const;
export const MODAL_TITLE_MAX = 45;
export const INPUT_LABEL_MAX = 45;
export const MODAL_INPUTS_MAX = 5;

export function toModal(modal: Modal): Record<string, unknown> {
  return {
    custom_id: modal.customId,
    title: modal.title.slice(0, MODAL_TITLE_MAX),
    components: modal.inputs.slice(0, MODAL_INPUTS_MAX).map((input) => ({
      type: ROW,
      components: [
        {
          type: TEXT_INPUT,
          custom_id: input.id,
          label: input.label.slice(0, INPUT_LABEL_MAX),
          style: input.long ? STYLE.paragraph : STYLE.short,
          max_length: input.max,
          required: input.required,
        },
      ],
    })),
  };
}
