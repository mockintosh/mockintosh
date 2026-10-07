/** `import.meta.url`, which the core's environment doesn't list but every module host provides. */
interface ImportMeta {
  readonly url: string;
}
