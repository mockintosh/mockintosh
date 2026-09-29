import {
  Attachment,
  Bubble,
  Marker,
  Message,
  MessageScroller,
  Questionnaire,
  Show,
  createSignal,
} from "@mockintosh/ui";
import type { JSX } from "@mockintosh/ui";
import { PageTitle, Preview } from "../layout";

export function BubblePage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Bubble"
        lede="1-bit chat surface. Outline for them, invert for you. No tint variants."
      />
      <Preview
        code={`<Bubble>How can I help?</Bubble>
<Bubble align="end">Build a counter.</Bubble>`}
      >
        <box flexDirection="column" gap={8} width={260}>
          <Bubble>How can I help?</Bubble>
          <Bubble align="end">Build a counter.</Bubble>
        </box>
      </Preview>
    </box>
  );
}

export function MessagePage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Message"
        lede="Avatar, header, Bubble, footer. align=end is the current user."
      />
      <Preview
        code={`<Message align="start" initials="G" name="Gippity">
  How can I help?
</Message>
<Message align="end" initials="Y" footer="delivered">
  Build a counter.
</Message>`}
      >
        <box flexDirection="column" gap={8} width={280}>
          <Message align="start" initials="G" name="Gippity">
            How can I help?
          </Message>
          <Message align="end" initials="Y" footer="delivered">
            Build a counter.
          </Message>
        </box>
      </Preview>
    </box>
  );
}

export function MessageScrollerPage(): JSX.Element {
  const [n, setN] = createSignal(3);
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Message Scroller"
        lede="Stick-to-bottom thread. It follows new lines while you are at the end, and holds still once you scroll up."
      />
      <Preview
        code={`<MessageScroller height={120}>
  ...
</MessageScroller>`}
      >
        <box flexDirection="column" gap={8}>
          <MessageScroller height={120}>
            <Message align="start">one</Message>
            <Message align="end">two</Message>
            <Message align="start">three</Message>
            <Show when={n() > 3}>
              <Message align="end">{`line ${n()}`}</Message>
            </Show>
          </MessageScroller>
          <text
            font="body"
            cursor="pointer"
            onClick={() => setN((c) => c + 1)}
          >
            add a line
          </text>
        </box>
      </Preview>
    </box>
  );
}

export function MarkerPage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle title="Marker" lede="Inline status, a date rule, or a busy tool line." />
      <Preview
        code={`<Marker>Explored 4 files</Marker>
<Marker variant="separator">Today</Marker>
<Marker busy>Checking logs</Marker>`}
      >
        <box flexDirection="column" gap={8} width={260}>
          <Marker>Explored 4 files</Marker>
          <Marker variant="separator">Today</Marker>
          <Marker busy>Checking logs</Marker>
        </box>
      </Preview>
    </box>
  );
}

export function AttachmentPage(): JSX.Element {
  const [gone, setGone] = createSignal(false);
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Attachment"
        lede="File chip with name, size, and optional Progress. It does not upload."
      />
      <Preview
        code={`<Attachment
  title="notes.txt"
  description="12 KB"
  state="uploading"
  progress={0.4}
  onRemove={() => setGone(true)}
/>`}
      >
        <box width={280}>
          {gone() ? (
            <text font="body">removed</text>
          ) : (
            <Attachment
              title="notes.txt"
              description="12 KB"
              state="uploading"
              progress={0.4}
              onRemove={() => setGone(true)}
            />
          )}
        </box>
      </Preview>
    </box>
  );
}

export function QuestionnairePage(): JSX.Element {
  const [index, setIndex] = createSignal(0);
  const [value, setValue] = createSignal("");
  const [done, setDone] = createSignal("");
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Questionnaire"
        lede="Multi-step agent prompt. Radio plus Field plus Progress. Not a form framework."
      />
      <Preview
        code={`<Questionnaire
  index={index()}
  value={value()}
  onChange={setValue}
  onNext={() => { setIndex((n) => n + 1); setValue(""); }}
  onPrevious={() => setIndex((n) => n - 1)}
  onSubmit={() => setDone(value())}
  items={STEPS}
/>`}
      >
        {done() ? (
          <text font="body">{`done: ${done()}`}</text>
        ) : (
          <Questionnaire
            index={index()}
            value={value()}
            onChange={setValue}
            onNext={() => {
              setIndex((n) => n + 1);
              setValue("");
            }}
            onPrevious={() => setIndex((n) => Math.max(0, n - 1))}
            onSubmit={() => setDone(value())}
            items={[
              {
                name: "kind",
                prompt: "What should we build?",
                description: "Pick one, or go back later.",
                choices: [
                  { value: "app", label: "An app" },
                  { value: "note", label: "A note" },
                ],
              },
              {
                name: "when",
                prompt: "When should it start?",
                choices: [
                  { value: "now", label: "Now" },
                  { value: "later", label: "Later" },
                ],
              },
            ]}
          />
        )}
      </Preview>
    </box>
  );
}
