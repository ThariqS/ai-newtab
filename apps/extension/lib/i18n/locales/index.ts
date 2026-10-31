/**
 * The languages the interface offers, in the picker's order. English comes
 * first: it is the source catalog and the fallback. To add a language, import
 * its catalog and add one line (see ../README.md).
 */
import type { Locale } from "..";
import en from "./en";
import fr from "./fr";

export const LOCALES: Locale[] = [
  { code: "en", name: "English", messages: en },
  { code: "fr", name: "Français", messages: fr },
];
