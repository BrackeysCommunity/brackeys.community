export interface Theme {
  id: string;
  name: string;
  description: string;
}

export const themes: Theme[] = [
  {
    id: "brackeys",
    name: "Brackeys",
    description: "Default Brackeys community theme",
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "A dark theme with vibrant colors",
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic, north-bluish color palette",
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    description: "Warm, pastel dark theme",
  },
  {
    id: "one-dark",
    name: "One Dark",
    description: "Atom's iconic dark theme",
  },
  {
    id: "solarized",
    name: "Solarized Dark",
    description: "Precision colors for machines and people",
  },
  {
    id: "palenight",
    name: "Palenight",
    description: "Material's soft indigo night",
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    description: "Retro groove, warm and low contrast",
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    description: "Retro groove on cream paper",
  },
];

export const DEFAULT_THEME_ID = "nord";
