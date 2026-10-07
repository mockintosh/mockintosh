import { defineSprite, fromGrid, type Sprite } from "@mockintosh/ui";

const ICON_1BITCAMERA = defineSprite(
  32,
  32,
  "AKqqqqqqqgAKVVVVVVVVoCVVVVVVVVVYJVVVaqlVVViVVVaVVpVVVpVVaWqpaVVWlVWWqqqWVVaVVmqqqqmVVpVZqqqqqmVWlWaqlaqqmVaVZqlVaqqZVpWapVWqqqZWlZqlWqqqplaWapVpqqqplpZqlaaqqqmWlmqVqqqqqZaWaqaqqqqplpZqqqqmqqmWlmqqqpaaqZaVmqqqqpamVpWaqqqqVqZWlWaqqqVamVaVZqqqqWqZVpVZqqqqqmVWlVZqqqqplVaVVZaqqpZVVpVVaWqpaVVWlVVWlVaVVVYlVVVqqVVVWCVVVVVVVVVYClVVVVVVVaAAqqqqqqqqAA=="
);
const ICON_MACFLIM = defineSprite(
  32,
  32,
  "AAAAqqoAAAAAACpmpqgAAAACpqmqqoAAAAppmpqaoAAAKqqpqqqoAACmmqqqamoAAqmpmqqqqoAKaqqqmqqqYAmpqqmqmpqgKpqZqqqqqqgpqqlqqapqqCqqqVaqqqqomampVWqqqqqqqqlVVqqqqppqqVVVaqqqqqaZVVVWqqqaqqlVVVWqqqqqqVVVWqqqqmqpVVWqqqqqqmlVWqqqqCaqqVWqqqqoKqqpWqqqqqgpqqmqqqqqqAqaqqqqqqqgCqqqqqqqqqACqqqqqqqqgACqqqqqqqoAACqqqqqqqAAACqqqqqqgAAACqqqqqoAAAAAqqqqoAAAAAACqqgAAAA=="
);
const ICON_APPSTORE_16X16 = defineSprite(
  16,
  16,
  "CqqqoCqqqqiqqWqqqqlqqqqlWqqqpVqqqpWWqqqWlqqlVWVapVVlWqqqpaqpaqlqqWqpaqqqqqoqqqqoCqqqoA=="
);
const ICON_FINDER_16X16 = defineSprite(
  16,
  16,
  "CqqqoAlVVWAKqqqgCqqloAqqVaAKpVWgCqVVoAqpVaAKqqqgCVVVYAlVVWAJVapgCVVVYAqqqqAJVVVgCqqqoA=="
);
const ICON_APPSTORE_32X32 = defineSprite(
  32,
  32,
  "ACqqqqqqqAACqqqqqqqqgAqqqqqqqqqgKqqqqqqqqqgqqqqWlqqqqKqqqlaVqqqqqqqqlWaqqqqqqqqVZqqqqqqqqqWaqqqqqqqqpZqqqqqqqqqmWqqqqqqqqpZmqqqqqqqqmaaqqqqqqqpZpaqqqqqqqmaZqqqqqqqpZplqqqqqqqmapmqqqqqqpZqmWqqqqqVVVWmVWqqqmZmZqZZmqqqlVVVaZpqqqqqqqqplqqqqqmaqqpmqqqqpZqqqmWqqqqlaqqqlaqqqqlqqqqWqqqqqqqqqqqqqKqqqqqqqqqgqqqqqqqqqqAqqqqqqqqqgAqqqqqqqqoAAKqqqqqqoAA=="
);
const ICON_APPSTORE_SMR_32X32 = defineSprite(
  32,
  32,
  "AKqqqqqqqgAKqqqqqqqqoCqqqqqqqqqoKqqqqqqqqqiqqqqWlqqqqqqqqlaVqqqqqqqqlWaqqqqqqqqVZqqqqqqqqqWaqqqqqqqqpZqqqqqqqqqmWqqqqqqqqpZmqqqqqqqqmaaqqqqqqqpZpaqqqqqqqmaZqqqqqqqpZplqqqqqqqmapmqqqqqqpZqmWqqqqqVVVWmVWqqqmZmZqZZmqqqlVVVaZpqqqqqqqqplqqqqqmaqqpmqqqqpZqqqmWqqqqlaqqqlaqqqqlqqqqWqqqqqqqqqqqqqqqqqqqqqqqoqqqqqqqqqqCqqqqqqqqqoCqqqqqqqqqAAqqqqqqqqAA=="
);
const ICON_APPSTORE2 = defineSprite(
  32,
  32,
  "ACqqqqqqqAACqqqqqqqqgAqlVVVVVVqgKlqqqqqqpagpqqqWlqqqaKmqqlaVqqpqpqqqlWaqqpqmqqqVZqqqmqaqqqWaqqqapqqqpZqqqpqmqqqmWqqqmqaqqpZmqqqapqqqmaaqqpqmqqpZpaqqmqaqqmaZqqqapqqpZplqqpqmqqmapmqqmqaqpZqmWqqapqVVVWmVWpqmmZmZqZZmmqalVVVaZpqapqqqqqplqpqmqmaqqpmqmqapZqqqmWqapqlaqqqlapqmqlqqqqWqmqmqqqqqqqpqKaqqqqqqqmgqWqqqqqqlqAqlVVVVVVqgAqqqqqqqqoAAKqqqqqqoAA=="
);
const ICON_CAMERA_32 = defineSprite(
  32,
  32,
  "ACqqqqqqqAAClVVVVVVWgAlmpqampqlgJqpqampqapgmpqampqammKpqampqampqpqampqampqaqaqqqaqqqaqapVlqpVVqmqqVVVVaqpqqpmqVVWpWpqqqVWlaaVmmqmpqllmpqaZqqmqmWmmlpqqmaaZValamqqpqZlVaqpqqampmVWVVamqqammVWZmaqqpqaZVVVVqqqmpplVVVWqqqaamVVVVaqqpqqZVVVVqqqmqpmqqqmqqqlVVVVVVqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqKqqqqqqqqqgqqqqqqqqqqAqqqqqqqqqgAqqqqqqqqoAAKqqqqqqoAA=="
);
const ICON_CAMERA = defineSprite(
  32,
  32,
  "AAAAAAAAAAAAAAAAIAAAAAAAAgAgAgAAAAAAgCAIAAAAAAAgICAAAAAAAAgggAAAAAAAAgIAAAAAACgAAACgAAAAAoqqigAAAAAACWWAAAAAAAAJqYAAAAAAKompiqAAAKAACWWAAAACqgCqqqoqoAJWKJVVViVgKqqqqqqqqqglVVVVVVVVWCVaqqqqqqpYJVlVVapVVlglaVVaVaVWmCVpVWWqWVaYJWlVZlWZVpglaVWZVWZWmCVpaZlVZlaYJWlpmVVmVpglaaWZVWZWmCVpVWZVmVaYJWlVZapZVpglaVVaVaVWmCVpVVWqVVaYJVqqqqqqqlgqqqqqqqqqqA=="
);
const ICON_CAMERA3 = defineSprite(
  32,
  32,
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAqgAAAAAAqAKqgAAAAACYCVVgKqgAqqqpVWqVVgCqqqqqqpVWAKmqqVVqpVoAqqqVVVaqqgCpqlaqlaqqAKqqWlWlqqoAqalpVWlqqgCqqWVVWWqqAKqpZVVZaqoAqqllVVlqqgCqqWVVWWqqAKqpaVVpaqoAqqpaVaWqqgCqqlaqlaqqAKqqlVVWqqoAqqqpVWqqqgCqqqqqqqqqAKqqqqqqqqoA=="
);
const ICON_CHAT = defineSprite(
  32,
  32,
  "qqqqqqqqqqqVVWqqqqqqqpVVaqqqqqqqlVVqqqqqqqqVVWqqqqqqqpVVaqqVVWqqlZVqqVVVVqqVlWqlVVVVqpWVapVVVVVqlVVqlVVVVWqVVWpVVVVVWpVValVVVVValVVqVVVVVVqVVWpVVVVVWpVValVVVVValVVqVVVVVVqVVWpVVVVVWpVValVVVVValVVqVVVVVVqVVWpVVVVVWpVqqlVVVVValVaqVVVVVVqVVqpVVVVVapVWqlVVVVVqlVaqVVVVVaqVVqlVVVVWqpWqlVVVVWqqlVaqqqqqqqqVVqqqqqqqqpVWqqqqqqqqlVaqqqqqqqqqqqqqqqqqqg=="
);
/** System 7.5.3: System -16482 · ics# (the 16×16 Apple drew for this Macintosh) */
const ICON_COMPUTER_16X16 = defineSprite(
  16,
  16,
  "AAAAAAKqqoAJVVVgCaqqYAmVVmAJmZZgCZVWYAmZVmAJlVZgCaqqYAlVVWAJVVVgCVWqYAlVVWACqqqAAqqqgA=="
);
const ICON_COMPUTER = defineSprite(
  32,
  32,
  "AAAAAAAAAAAAKqqqqqqoAACVVVVVVVYAAJVVVVVVVgAAlaqqqqpWAACWVVVVVZYAAJZmZmZVlgAAllVVVVWWAACWZmZVVZYAAJZVVVVVlgAAlmZVVVWWAACWVVVVVZYAAJZmVVVVlgAAllVVVVWWAACWZmVVVZYAAJZVVVVVlgAAllVVVVWWAACVqqqqqlYAAJVVVVVVVgAAlVVVVVVWAACVVVVVVVYAAJVVVVVVVgAAlVVVqqpWAACVVVVVVVYAAJVVVVVVVgAAlVVVVVVWAACVVVVVVVYAACqqqqqqqAAAJVVVVVVYAAAlVVVVVVgAACVVVVVVWAAAKqqqqqqoAA=="
);
const ICON_FILE = defineSprite(
  32,
  32,
  "AqqqqqqgAAACVVVVVWgAAAJVVVVVZgAAAlVVVVVlgAACVVVVVWVgAAJVVVVVZVgAAlVVVVVqqgACVVVVVVVWAAJVVVVVVVYAAlVVVVVVVgACVqampppWAAJVVVVVVVYAAlVVVVVVVgACVqapqmpWAAJVVVVVVVYAAlVVVVVVVgACVpqqmppWAAJVVVVVVVYAAlVVVVVVVgACVVVVVVVWAAJVVVVVVVYAAlVVVVVVVgACVVVVVVVWAAJVVVVVVVYAAlVVVVVVVgACVVVVVVVWAAJVVVVVVVYAAlVVVVVVVgACVVVVVVVWAAJVVVVVVVYAAlVVVVVVVgACqqqqqqqqAA=="
);
const ICON_FILE0 = defineSprite(
  32,
  32,
  "AqqqqqqgAAACVVVVVWgAAAJVVVVVZgAAAlVVVVVlgAACVVVVVWVgAAJVamqapVgAAlVVVVVqqgACVqamqlVWAAJVVVVVVVYAAlaqaqmqVgACVVVVVVVWAAJWpqamqVYAAlVVVVVVVgACVVVVVVVWAAJVapqmqlYAAlVVVVVVVgACVqmqappWAAJVVVVVVVYAAlaapqmqVgACVVVVVVVWAAJWqaqapVYAAlVVVVVVVgACVVVVVVVWAAJVapqaalYAAlVVVVVVVgACVqmpqapWAAJVVVVVVVYAAlamqmqaVgACVVVVVVVWAAJVVVVVVVYAAlVVVVVVVgACqqqqqqqqAA=="
);
const ICON_FILM = defineSprite(
  32,
  32,
  "AAKqoAAAAAAAAmqgAAAAAAACaqAAAAAAqqqqqqqAAAClqqqqqoAAAKqqqqqqgAAAJVVWVpoAAAAlVVVmpgAAACVVVlaaAAAAJVVVZqYAAAAlVVZWmgAAACVVVWamAAAAJVVWVpoAAAAlVVVmpgAAACVVVlaaAAAAJVVVZqYAAAAlVVZWqqqqqCVVVWaVVVVWJVVWVpVVVVYlVVVmlVVVViVVVlaVVVVWJVVVZpVVVVYlVVZWlVVVViVVVWaVVVVWJVVWVqampqYlVVVmpmZmZiVVVlampqamJVVVZpVVVVYlVVZWqqqqqqqqqqqqgAAApaqqqqqAAACqqqqqqoAAAA=="
);
const ICON_FOLDER = defineSprite(
  32,
  32,
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACqqgAAAAAAAlVVgAAAAAAJVVVgAAAAACqqqqqqqqqolVVVVVVVVVaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaqqqqqqqqqqg=="
);
const ICON_HAPPY = defineSprite(
  32,
  32,
  "ACqqqqqqoAAAlVVVVVVYAAJVVVVVVVYAAlaqqqqqVgACWVVVVVWWAAJZVVVVVZYAAllVVVVVlgACWVZWVlWWAAJZVlZWVZYAAllVVlVVlgACWVVWVVWWAAJZVVpVVZYAAllVVVVVlgACWVWVZVWWAAJZVWqVVZYAAllVVVVVlgACWVVVVVWWAAJWqqqqqlYAAlVVVVVVVgACVVVVVVVWAAJVVVVVVVYAAlVVVVVVVgACWlVVWqpWAAJVVVVVVVYAAlVVVVVVVgACVVVVVVVWAAJVVVVVVVYAAKqqqqqqqAAAlVVVVVVYAACVVVVVVVgAAJVVVVVVWAAAqqqqqqqoAA=="
);
const ICON_HD = defineSprite(
  32,
  32,
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqqqqqqqqqiVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaVlVVVVVVVVpVVVVVVVVVWlVVVVVVVVVYqqqqqqqqqqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
);
const ICON_MOVIE = defineSprite(
  32,
  32,
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAqqqqqqqqqqCqqqqqqqqqoKWlpaWlpaWgpaWlpaWlpaCqqqqqqqqqoKqqqqqqqqqgpVVVVVVVVaClVVVVVVVVoKVVVVVVVVWgpVVWlVVVVaClVVapVVVVoKVVVqqVVVWgpVVWqqlVVaClVVaqqpVVoKVVVqqqlVWgpVVWqqlVVaClVVaqlVVVoKVVVqlVVVWgpVVWlVVVVaClVVVVVVVVoKVVVVVVVVWgpVVVVVVVVaCqqqqqqqqqoKqqqqqqqqqgpaWlpaWlpaClpaWlpaWloKqqqqqqqqqgqqqqqqqqqqA=="
);
const ICON_PHOTOBOOTH_32X32 = defineSprite(
  32,
  32,
  "ACqqqqqqqAAClVVVVVVWgAlmpqampqlgJqpqaqpqapgmpqaVVqammKpqaWqpampqpqaWqqqWpqaqamqqqqmqaqapqqqqqmamqqaqlaqqmqqppqlVaqqZqqqapVWqqqaqmpqlWqqqppqqapVpqqqpqqpqlaaqqqmqqmqVqqqqqaqaaqaqqqqpmqpqqqqmqqmqqmqqqpaaqaqqmqqqqpamqqqaqqqqVqaqqqaqqqVamqqqpqqqqWqaqqqpqqqqqmqqqqpqqqqpqqqqqpaqqpaqqqqqqWqpaqqqKqqqlVaqqqgqqqqqqqqqqAqqqqqqqqqgAqqqqqqqqoAAKqqqqqqoAA=="
);
const ICON_PHOTOBOOTH_SMR_32 = defineSprite(
  32,
  32,
  "AKqqqqqqqgAKVVVVVVVVoCWmpqampqZYJmpqaqpqapiapqaVVqampqpqaWqpampqpqaWqqqWpqaqamqqqqmqaqapqqqqqmamqqaqlaqqmqqppqlVaqqZqqqapVWqqqaqmpqlWqqqppqqapVpqqqpqqpqlaaqqqmqqmqVqqqqqaqaaqaqqqqpmqpqqqqmqqmqqmqqqpaaqaqqmqqqqpamqqqaqqqqVqaqqqaqqqVamqqqpqqqqWqaqqqpqqqqqmqqqqpqqqqpqqqqqpaqqpaqqqqqqWqpaqqqqqqqlVaqqqoqqqqqqqqqqCqqqqqqqqqoCqqqqqqqqqAAqqqqqqqqAA=="
);
/** System 7 stop-hand (raised palm), drawn as 1-bit pixel art. */
const ICON_STOP = fromGrid(32, 32, [
  "................................",
  ".........####..###..####........",
  "........#####..###..#####.......",
  ".......######..###..######......",
  "......#######..###..#######.....",
  "......##..###..###..###..##.....",
  ".....##...###..###..###...##....",
  ".....##...###..###..###...##....",
  ".....##...###..###..###...##....",
  "....###...###..###..###...###...",
  "....##....###..###..###....##...",
  "....##....###.......###....##...",
  "....##.....###.....###.....##...",
  "....##......##.....##......##...",
  "....###....................###..",
  "....###....................###..",
  "....####..................####..",
  ".....###................###.....",
  ".....####................####...",
  "......###................###....",
  "......####..............####....",
  ".......###..............###.....",
  ".......####............####.....",
  "........###............###......",
  "........##################......",
  ".........################.......",
  "..........##############........",
  "...........############.........",
  "............##########..........",
  ".............########...........",
  "..............######............",
  "................................",
]);
const ICON_SAD = defineSprite(
  32,
  32,
  "ACqqqqqqoAAAlVVVVVVYAAJVVVVVVVYAAlaqqqqqVgACWVVVVVWWAAJZVVVVVZYAAllZlVmVlgACWVZVVlWWAAJZWZVZlZYAAllVVVVVlgACWVVllVWWAAJZVVpVVZYAAllVVVVVlgACWVWqpVWWAAJZVlVaVZYAAllVVVWVlgACWVVVVVWWAAJWqqqqqlYAAlVVVVVVVgACVVVVVVVWAAJVVVVVVVYAAlVVVVVVVgACWlVVWqpWAAJVVVVVVVYAAlVVVVVVVgACVVVVVVVWAAJVVVVVVVYAAKqqqqqqqAAAlVVVVVVYAACVVVVVVVgAAJVVVVVVWAAAqqqqqqqoAA=="
);
const ICON_SAFARI = defineSprite(
  32,
  32,
  "AAAAqqoAAAAAACpVVagAAAAClVaVVoAAAApZVpVloAAAJVZWlZVYAACVVlaVlVYAAllVVVVVVYAKVlVVVVVloAlVlVVVVpVgJVVVVVVaVVgmVVVVVapVmCWlVVVaqVpYlVVVVWqlVVaVVVVWqpVVVpVVVVqqVVVWmqVVZqpVWqaapVWVqVVappVVVZVlVVVWlVVWVpVVVVaVVVlZVVVVViWlZaVVVVpYJlWaVVVVVZglVaVVVVVVWAlWlVVVVlVgCllVVVVVlaACVVVVVVVlgACVVlaVlVYAACVWVpWVWAAACllWlWWgAAAClVaVVoAAAAAqVVWoAAAAAACqqgAAAA=="
);
const ICON_TRASH = defineSprite(
  32,
  32,
  "AAAAKqAAAAAAAACVWAAAAAAqqqqqqqAAAJVVVVVVWAAAlVVVVVVYAACqqqqqqqgAACVVVVVVYAAAJVVVVVVgAAAlWVlZWWAAACVlZWVlYAAAJWVlZWVgAAAlZWVlZWAAACVlZWVlYAAAJWVlZWVgAAAlZWVlZWAAACVlZWVlYAAAJWVlZWVgAAAlZWVlZWAAACVlZWVlYAAAJWVlZWVgAAAlZWVlZWAAACVlZWVlYAAAJWVlZWVgAAAlZWVlZWAAACVlZWVlYAAAJWVlZWVgAAAlZWVlZWAAACVlZWVlYAAAJVlZWVlgAAAlVVVVVWAAACVVVVVVYAAACqqqqqqAAA=="
);
const ICON_VIDEO = defineSprite(
  32,
  32,
  "qqqqqqqqqqqVVVVVVVVVVpVVVVVVVVVWmqWqWqWqWqaZZZZZZZZZZplllllllllmmqWqWqWqWqaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaVVVVVVVVVVpVVVpVVVVVWlVVWqVVVVVaVVVaqlVVVVpVVVqqpVVVWlVVWqqqVVVaVVVaqqpVVVpVVVqqpVVVWlVVWqpVVVVaVVVapVVVVVpVVVpVVVVVWlVVVVVVVVVaVVVVVVVVVVpVVVVVVVVVWlVVVVVVVVVaapapapapapplllllllllmmWWWWWWWWWaapapapapappVVVVVVVVVWlVVVVVVVVVaqqqqqqqqqqg=="
);

/** ryos: mac-os-8/applications/atm-4-0-2-installer-resource-6208-applications.png · threshold */
const ICON_FOUNDRY_ICON = defineSprite(
  32,
  32,
  "VVVVVVVVVVWqqqqqqqqqqlVVVVVVVVVVqqqqqqqqqqpVVVVVVVWVlaqqqqqqqlWqVVVVVVVZVZWqqqqqqqVVqlVVVVVVlVWVqqqqqqpVVapVVVVVWVVVlaqqqqqlVVWqVVVVVZVVVZWqqqqqVVVVqlVVVVlVWVWVqqqqpVVpVapVVVWVVZlVlaqqqlVWqVWqVVVZVVlZVZWqqqVVaqlVqlVVlVVVVVWVqqpVVVVVVapVWVVVVVVVlaqlVWqqqVWqVZVVlVVZVZWqVVaqqqlVqllVWVVVWVWVpVVqqqqpVaqVVZVVVVlVlaqqqqqqqqqqVVVVVVVVVVWqqqqqqqqqqg=="
);
/** Document page with a dog-eared corner and three lines of text. */
const ICON_FILE_16X16 = fromGrid(16, 16, [
  "..########......",
  "..#oooooo##.....",
  "..#oooooo#o#....",
  "..#oooooo#oo#...",
  "..#oooooo#####..",
  "..#oooooooooo#..",
  "..#o###o####o#..",
  "..#oooooooooo#..",
  "..#o#####o##o#..",
  "..#oooooooooo#..",
  "..#o##o####oo#..",
  "..#oooooooooo#..",
  "..#oooooooooo#..",
  "..#oooooooooo#..",
  "..#oooooooooo#..",
  "..############..",
]);
/** Flash camera: burst rays over the flash, a wide body and a two-ring lens. */
const ICON_CAMERA_16X16 = fromGrid(16, 16, [
  "...#...##...#...",
  "....#......#....",
  "....########....",
  ".##.#oooooo#.##.",
  "################",
  "#oooooooooooooo#",
  "#ooooo####ooooo#",
  "#oooo##oo##oooo#",
  "#ooo##oooo##ooo#",
  "#ooo#oo##oo#ooo#",
  "#ooo#oo##oo#ooo#",
  "#ooo##oooo##ooo#",
  "#oooo##oo##oooo#",
  "#ooooo####ooooo#",
  "#oooooooooooooo#",
  "################",
]);
/** Solid black disc with a white play triangle. */
const ICON_MACFLIM_16X16 = fromGrid(16, 16, [
  "......####......",
  "....########....",
  "...##########...",
  "..############..",
  ".####oo########.",
  ".####oooo######.",
  "#####oooooo#####",
  "#####ooooooo####",
  "#####ooooooo####",
  "#####oooooo#####",
  ".####oooo######.",
  ".####oo########.",
  "..############..",
  "...##########...",
  "....########....",
  "......####......",
]);
/** Black rounded square with a lit top edge and a white lens ring with a highlight. */
const ICON_PHOTOBOOTH_SMR_32_16X16 = fromGrid(16, 16, [
  "..############..",
  ".##oooooooooo##.",
  "################",
  "######oooo######",
  "####ooo##ooo####",
  "###oo######oo###",
  "###o##oo####o###",
  "###o#oo###o#o###",
  "###o#o####o#o###",
  "###o#####o##o###",
  "###oo######oo###",
  "####ooo##ooo####",
  "######oooo######",
  "################",
  ".##############.",
  "..############..",
]);
/** Compass: round dial, four ticks, and a needle solid to the north-east. */
const ICON_SAFARI_16X16 = fromGrid(16, 16, [
  "......####......",
  "....##oooo##....",
  "...#ooo##ooo#...",
  "..##oooooooo##..",
  ".#ooooooooo#oo#.",
  ".#oooooooo##oo#.",
  "#oooooooo##oooo#",
  "#o#oooo###ooo#o#",
  "#o#ooo###oooo#o#",
  "#oooo#ooooooooo#",
  ".#oo#ooooooooo#.",
  ".#oooooooooooo#.",
  "..##oooooooo##..",
  "...#ooo##ooo#...",
  "....##oooo##....",
  "......####......",
]);
/** fx: the black tile with its paper bar on the left and the round bubble beside it. */
const ICON_CHAT_16X16 = fromGrid(16, 16, [
  "################",
  "#oooo###########",
  "#oooo####oooo###",
  "#oooo##ooooooo##",
  "#oooo#ooooooooo#",
  "#oooo#ooooooooo#",
  "#oooo#ooooooooo#",
  "#oooo#ooooooooo#",
  "#oooo#ooooooooo#",
  "#oooo#ooooooooo#",
  "#oooo#ooooooooo#",
  "#oooo#oooooooo##",
  "#oooo#ooooooo###",
  "#ooo#ooooo######",
  "#oooo###########",
  "################",
]);
export const iconSprites: Record<string, Sprite> = {
  "icon/1bitcamera": ICON_1BITCAMERA,
  "icon/MacFlim": ICON_MACFLIM,
  "icon/MacFlim-16x16": ICON_MACFLIM_16X16,
  "icon/appstore-16x16": ICON_APPSTORE_16X16,
  "icon/appstore-32x32": ICON_APPSTORE_32X32,
  "icon/appstore-smr-32x32": ICON_APPSTORE_SMR_32X32,
  "icon/appstore2": ICON_APPSTORE2,
  "icon/finder-16x16": ICON_FINDER_16X16,
  "icon/camera-32": ICON_CAMERA_32,
  "icon/camera": ICON_CAMERA,
  "icon/camera-16x16": ICON_CAMERA_16X16,
  "icon/camera3": ICON_CAMERA3,
  "icon/chat": ICON_CHAT,
  "icon/chat-16x16": ICON_CHAT_16X16,
  "icon/computer": ICON_COMPUTER,
  "icon/computer-16x16": ICON_COMPUTER_16X16,
  "icon/file": ICON_FILE,
  "icon/file-16x16": ICON_FILE_16X16,
  "icon/file0": ICON_FILE0,
  "icon/film": ICON_FILM,
  "icon/folder": ICON_FOLDER,
  "icon/happy": ICON_HAPPY,
  "icon/hd": ICON_HD,
  "icon/movie": ICON_MOVIE,
  "icon/photobooth-32x32": ICON_PHOTOBOOTH_32X32,
  "icon/photobooth-smr-32": ICON_PHOTOBOOTH_SMR_32,
  "icon/photobooth-smr-32-16x16": ICON_PHOTOBOOTH_SMR_32_16X16,
  "icon/sad": ICON_SAD,
  "icon/stop": ICON_STOP,
  "icon/safari": ICON_SAFARI,
  "icon/safari-16x16": ICON_SAFARI_16X16,
  "icon/trash": ICON_TRASH,
  "icon/video": ICON_VIDEO,
  "foundry/icon": ICON_FOUNDRY_ICON,
};
