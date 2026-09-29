import {
  Avatar,
  Badge,
  Breadcrumb,
  Bubble,
  Button,
  Card,
  Checkbox,
  Field,
  Item,
  Kbd,
  Marker,
  Message,
  MessageScroller,
  Note,
  Pagination,
  Progress,
  Select,
  Slider,
  Switch,
  Table,
  Tabs,
  TextInput,
  createSignal,
} from "@mockintosh/ui";
import type { JSX } from "@mockintosh/ui";
import billA from "../assets/bill-a.png";
import { useCompact } from "../layout";

function Cell(props: { children?: JSX.Element }): JSX.Element {
  return (
    <box flexGrow={1} flexBasis={0} flexShrink={1} minWidth={0}>
      {props.children}
    </box>
  );
}

function SignInCard(): JSX.Element {
  const [mail, setMail] = createSignal("");
  const [pass, setPass] = createSignal("secret");
  const [stay, setStay] = createSignal(true);
  return (
    <Card title="Sign in">
      <Field label="Mail">
        <TextInput width={180} value={mail()} onChange={setMail} placeholder="you@site.com" />
      </Field>
      <Field label="Password">
        <TextInput width={180} value={pass()} onChange={setPass} password />
      </Field>
      <Checkbox checked={stay()} onChange={setStay} label="Keep me signed in" />
      <Button label="Continue" onClick={() => setMail("")} />
    </Card>
  );
}

function ThreadCard(): JSX.Element {
  const [draft, setDraft] = createSignal("");
  return (
    <Card title="Thread">
      <Message align="start" initials="G" name="Gippity">
        How can I help?
      </Message>
      <Message align="end" initials="Y" footer="delivered">
        A 1-bit counter, please.
      </Message>
      <box flexDirection="row" gap={6} alignItems="center">
        <TextInput width={140} value={draft()} onChange={setDraft} placeholder="Message" />
        <Button label="Send" onClick={() => setDraft("")} />
      </box>
    </Card>
  );
}

function AgentCard(): JSX.Element {
  const [prompt, setPrompt] = createSignal("");
  return (
    <Card title="Agent" padding={0}>
      <MessageScroller height={140} padding={8}>
        <Bubble align="end">Make the header rule dotted.</Bubble>
        <Marker>Read layout.tsx</Marker>
        <Marker>Patched SiteHeader</Marker>
        <text font="body" wrap selectable>
          The bottom rule is a 1px vstripe. The active item underline sits on that same line, so it moves on the dots.
        </text>
        <Bubble align="end">Same treatment for the sidebar.</Bubble>
        <Marker>Patched DocsLayout</Marker>
        <text font="body" wrap selectable>
          The sidebar divider is hstripe now, 1-on/1-off like the header.
        </text>
        <Bubble align="end">Add an Agent card on the home page.</Bubble>
        <Marker>Read homeShowcase.tsx</Marker>
        <Marker>Edit HomeShowcase</Marker>
        <text font="body" wrap selectable>
          Thread stays a conversation. Agent is a work session: tools as markers, reply as plain text.
        </text>
        <Bubble align="end">Make the transcript scroll.</Bubble>
        <Marker>Wrapped the log</Marker>
        <text font="body" wrap selectable>
          Extra turns sit in a stick-to-bottom pane so the prompt stays put.
        </text>
      </MessageScroller>
      <box padding={8} flexDirection="row" gap={6} alignItems="center">
        <TextInput width={140} value={prompt()} onChange={setPrompt} placeholder="Prompt" />
        <Button label="Run" onClick={() => setPrompt("")} />
      </box>
    </Card>
  );
}

function PeopleCard(): JSX.Element {
  return (
    <Card title="People">
      <Item title="Susan K." description="Icons" media={<Avatar initials="SK" />}>
        <Badge invert>edit</Badge>
      </Item>
      <Item title="Bill A." description="Finder" media={<Avatar initials="BA" src={billA} />}>
        <Badge>view</Badge>
      </Item>
      <Item title="Andy H." description="QuickDraw" media={<Avatar initials="AH" />}>
        <Badge>view</Badge>
      </Item>
    </Card>
  );
}

function DeskCard(): JSX.Element {
  const [mail, setMail] = createSignal(true);
  const [vol, setVol] = createSignal(0.6);
  return (
    <Card title="Desk">
      <Switch checked={mail()} onChange={setMail} label="Mail alerts" />
      <Slider
        label="Speaker"
        width={120}
        value={vol()}
        onChange={setVol}
        format={(v) => `${Math.round(v * 10)}`}
      />
      <box flexDirection="row" gap={6} alignItems="center">
        <text font="body">Save</text>
        <Kbd>⌘S</Kbd>
      </box>
    </Card>
  );
}

function CatalogCard(): JSX.Element {
  return (
    <Card title="Catalog">
      <Table
        headers={["Name", "Kind", "Size"]}
        rows={[
          ["Read Me", "TEXT", "4K"],
          ["MacPaint", "APPL", "62K"],
          ["System", "INIT", "120K"],
        ]}
      />
    </Card>
  );
}

function PaneCard(): JSX.Element {
  const [pane, setPane] = createSignal("files");
  return (
    <Card title="Pane">
      <Tabs
        value={pane()}
        onChange={setPane}
        items={[
          { value: "files", label: "Files" },
          { value: "info", label: "Info" },
        ]}
      >
        <box padding={6}>
          <text font="body" wrap>
            {pane() === "files" ? "3 items on this disk." : "Macintosh HD, 400K free."}
          </text>
        </box>
      </Tabs>
    </Card>
  );
}

function NoticeCard(): JSX.Element {
  return (
    <Card title="Notice">
      <Note variant="caution">Disk almost full. Empty the trash.</Note>
      <Progress value={0.82} width={160} />
    </Card>
  );
}

function FindCard(): JSX.Element {
  const [city, setCity] = createSignal("sf");
  const [query, setQuery] = createSignal("");
  const [page, setPage] = createSignal(1);
  return (
    <Card title="Find">
      <Breadcrumb
        items={[
          { label: "Disk", onClick: () => {} },
          { label: "System" },
        ]}
      />
      <box flexDirection="row" gap={8} alignItems="center">
        <Select
          value={city()}
          onChange={setCity}
          width={140}
          options={[
            { value: "sf", label: "San Francisco" },
            { value: "ny", label: "New York" },
            { value: "chicago", label: "Chicago" },
          ]}
        />
        <TextInput width={160} value={query()} onChange={setQuery} placeholder="Name" />
      </box>
      <Pagination page={page()} pageCount={5} onChange={setPage} />
    </Card>
  );
}

/** Live blocks of what the kit can compose. Same job as shadcn's landing grid. */
export function HomeShowcase(): JSX.Element {
  const compact = useCompact();
  const dir = () => (compact() ? "column" : "row");
  return (
    <box flexDirection="column" gap={12}>
      <box flexDirection={dir()} gap={12} alignItems="stretch">
        <Cell>
          <SignInCard />
        </Cell>
        <Cell>
          <ThreadCard />
        </Cell>
      </box>
      <box flexDirection={dir()} gap={12} alignItems="stretch">
        <Cell>
          <AgentCard />
        </Cell>
        <Cell>
          <PeopleCard />
        </Cell>
      </box>
      <box flexDirection={dir()} gap={12} alignItems="stretch">
        <Cell>
          <DeskCard />
        </Cell>
        <Cell>
          <CatalogCard />
        </Cell>
      </box>
      <box flexDirection={dir()} gap={12} alignItems="stretch">
        <Cell>
          <PaneCard />
        </Cell>
        <Cell>
          <NoticeCard />
        </Cell>
      </box>
      <FindCard />
    </box>
  );
}
