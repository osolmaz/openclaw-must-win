const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--namespace", "--work-tree"]);
const ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=/;

type Token = {
  dynamic: boolean;
  end: number;
  start: number;
  value: string;
};

type Span = {
  end: number;
  start: number;
};

type Quote = "double" | "none" | "single" | "backtick";

export function prefixGitCommitCommands(command: string, prefix: string): string {
  if (hasUnquotedHereDocument(command)) {
    return command;
  }
  const insertionPoints = findCommandSegments(command)
    .map((span) => findGitCommitInsertion(command, span))
    .filter((point): point is number => point !== undefined)
    .sort((left, right) => right - left);

  let rewritten = command;
  for (const point of insertionPoints) {
    rewritten = `${rewritten.slice(0, point)}${prefix}${rewritten.slice(point)}`;
  }
  return rewritten;
}

type ScanState = {
  escaped: boolean;
  quote: Quote;
};

function hasUnquotedHereDocument(command: string): boolean {
  let state: ScanState = { escaped: false, quote: "none" };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) {
      continue;
    }
    if (
      !state.escaped &&
      state.quote === "none" &&
      character === "<" &&
      command[index + 1] === "<"
    ) {
      return true;
    }
    state = advanceScanState(state, character);
  }
  return false;
}

function findCommandSegments(command: string): Span[] {
  const spans: Span[] = [];
  let segmentStart = 0;
  let state: ScanState = { escaped: false, quote: "none" };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) {
      continue;
    }
    if (!state.escaped && state.quote === "none" && isCommandBoundary(character)) {
      spans.push({ start: segmentStart, end: index });
      segmentStart = skipRepeatedBoundary(command, index);
      index = segmentStart - 1;
      continue;
    }
    state = advanceScanState(state, character);
  }
  spans.push({ start: segmentStart, end: command.length });
  return spans;
}

function advanceScanState(state: ScanState, character: string): ScanState {
  if (state.escaped) {
    return { ...state, escaped: false };
  }
  if (state.quote === "none") {
    return advanceUnquotedScanState(character);
  }
  if (state.quote === "single") {
    return { escaped: false, quote: character === "'" ? "none" : "single" };
  }
  const closingCharacter = state.quote === "double" ? '"' : "`";
  return {
    escaped: character === "\\",
    quote: character === closingCharacter ? "none" : state.quote,
  };
}

function advanceUnquotedScanState(character: string): ScanState {
  const quoteByCharacter: Readonly<Record<string, Quote>> = {
    "'": "single",
    '"': "double",
    "`": "backtick",
  };
  return {
    escaped: character === "\\",
    quote: quoteByCharacter[character] ?? "none",
  };
}

function isCommandBoundary(character: string): boolean {
  return character === ";" || character === "\n" || character === "|" || character === "&";
}

function skipRepeatedBoundary(command: string, index: number): number {
  const next = command[index + 1];
  return next === command[index] && (next === "|" || next === "&") ? index + 2 : index + 1;
}

function findGitCommitInsertion(command: string, span: Span): number | undefined {
  const tokens = tokenizeSegment(command, span);
  const commandIndex = findCommandToken(tokens);
  if (commandIndex === undefined || !isGitCommand(tokens[commandIndex])) {
    return undefined;
  }
  if (
    hasGitConfigAssignment(tokens, commandIndex) ||
    hasExplicitHooksPathOption(tokens, commandIndex + 1)
  ) {
    return undefined;
  }
  const subcommand = findGitSubcommand(tokens, commandIndex + 1);
  return subcommand?.value === "commit" ? tokens[commandIndex]?.start : undefined;
}

function tokenizeSegment(command: string, span: Span): Token[] {
  const tokens: Token[] = [];
  let index = span.start;
  while (index < span.end) {
    index = skipWhitespace(command, index, span.end);
    if (index >= span.end || command[index] === "#") {
      break;
    }
    const token = readToken(command, index, span.end);
    if (token.end === index) {
      break;
    }
    tokens.push(token);
    index = token.end;
  }
  return tokens;
}

function skipWhitespace(command: string, index: number, end: number): number {
  let cursor = index;
  while (cursor < end && /\s/.test(command[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

type TokenState = {
  dynamic: boolean;
  quote: Quote;
  value: string;
};

type TokenStep = TokenState & {
  consumed: number;
};

function readToken(command: string, start: number, end: number): Token {
  let cursor = start;
  let state: TokenState = { dynamic: false, quote: "none", value: "" };

  while (cursor < end) {
    const character = command[cursor];
    if (character === undefined || (state.quote === "none" && /\s/.test(character))) {
      break;
    }
    const step = readTokenCharacter(command, cursor, state);
    state = step;
    cursor += step.consumed;
  }

  return {
    dynamic: state.dynamic || state.quote !== "none",
    end: cursor,
    start,
    value: state.value,
  };
}

function readTokenCharacter(command: string, cursor: number, state: TokenState): TokenStep {
  const character = command[cursor] ?? "";
  if (state.quote === "none") {
    return readUnquotedTokenCharacter(command, cursor, state, character);
  }
  if (state.quote === "single") {
    return {
      ...state,
      consumed: 1,
      quote: character === "'" ? "none" : state.quote,
      value: character === "'" ? state.value : state.value + character,
    };
  }
  return readDynamicQuotedTokenCharacter(command, cursor, state, character);
}

function readUnquotedTokenCharacter(
  command: string,
  cursor: number,
  state: TokenState,
  character: string,
): TokenStep {
  const quoteByCharacter: Readonly<Record<string, Quote>> = {
    "'": "single",
    '"': "double",
    "`": "backtick",
  };
  const openingQuote = quoteByCharacter[character];
  if (openingQuote !== undefined) {
    return {
      ...state,
      consumed: 1,
      dynamic: state.dynamic || openingQuote === "backtick",
      quote: openingQuote,
    };
  }
  const nextCharacter = command[cursor + 1];
  if (character === "\\" && nextCharacter !== undefined) {
    return { ...state, consumed: 2, value: state.value + nextCharacter };
  }
  return {
    ...state,
    consumed: 1,
    dynamic: state.dynamic || character === "$",
    value: state.value + character,
  };
}

function readDynamicQuotedTokenCharacter(
  command: string,
  cursor: number,
  state: TokenState,
  character: string,
): TokenStep {
  const closingCharacter = state.quote === "double" ? '"' : "`";
  if (character === closingCharacter) {
    return { ...state, consumed: 1, quote: "none" };
  }
  const nextCharacter = command[cursor + 1];
  if (character === "\\" && nextCharacter !== undefined) {
    return { ...state, consumed: 2, value: state.value + nextCharacter };
  }
  return {
    ...state,
    consumed: 1,
    dynamic: state.dynamic || character === "$" || state.quote === "backtick",
    value: state.value + character,
  };
}

function findCommandToken(tokens: Token[]): number | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.dynamic) {
      return undefined;
    }
    if (!ASSIGNMENT_PATTERN.test(token.value)) {
      return index;
    }
  }
  return undefined;
}

function isGitCommand(token: Token | undefined): boolean {
  if (token === undefined || token.dynamic) {
    return false;
  }
  return token.value === "git" || token.value.endsWith("/git");
}

function hasGitConfigAssignment(tokens: Token[], commandIndex: number): boolean {
  return tokens.slice(0, commandIndex).some((token) => {
    const name = ASSIGNMENT_PATTERN.exec(token.value)?.[1];
    return name === "GIT_CONFIG_COUNT" || name?.startsWith("GIT_CONFIG_KEY_") === true;
  });
}

function hasExplicitHooksPathOption(tokens: Token[], start: number): boolean {
  return tokens.slice(start).some((token) => token.value.toLowerCase().includes("core.hookspath"));
}

function findGitSubcommand(tokens: Token[], start: number): Token | undefined {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined || token.dynamic) {
      return undefined;
    }
    if (token.value === "--") {
      return tokens[index + 1];
    }
    if (!token.value.startsWith("-")) {
      return token;
    }
    index += optionConsumesNextValue(token.value) ? 2 : 1;
  }
  return undefined;
}

function optionConsumesNextValue(option: string): boolean {
  return GIT_OPTIONS_WITH_VALUE.has(option);
}
