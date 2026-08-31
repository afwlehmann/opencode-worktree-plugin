const DEFAULT_TITLE_REGEX =
  /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export const isDefaultTitle = (title: string): boolean => DEFAULT_TITLE_REGEX.test(title)

export type StatusBarData = {
  readonly repoShort: string
  readonly branch: string
  readonly sessionTitle: string | undefined
  readonly preferNixDevelop: boolean
  readonly hasFlake: boolean
}

export const formatStatusBar = (data: StatusBarData): string => {
  const description =
    data.sessionTitle && !isDefaultTitle(data.sessionTitle)
      ? truncate(data.sessionTitle, 40)
      : "Untitled session"

  const nixBadge = data.preferNixDevelop && data.hasFlake ? " [nix]" : ""

  return `${data.repoShort}-${data.branch} :: ${description}${nixBadge}`
}

export const formatWindowTitle = (data: StatusBarData): string =>
  `:: OC :: ${data.repoShort}-${data.branch} :: ${
    data.sessionTitle && !isDefaultTitle(data.sessionTitle)
      ? truncate(data.sessionTitle, 40)
      : "Untitled session"
  }`

const truncate = (str: string, maxLen: number): string =>
  str.length > maxLen ? `${str.slice(0, maxLen - 3)}...` : str
