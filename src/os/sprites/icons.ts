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
  "ACqqqqqqqAAClVVVVVVWgAlmpqampqlgJqpqqqpqapgmpqqWlqqmmJpqqlaVqqpmpqqqlWaqpqqqaqqVZqqqaqaqqqWaqqqmqqqqpZqqqqqqqqqmWqqqqqqqqpZmqqqqmqqqmaaqqpqqqqpZpaqqqqqqqmaZqqqqqqqpZplqqqqaqqmapmqqmqqqpZqmWqqqqqVVVWmVWqqqmZmZqZZmqqqlVVVaZpqqqqqqqqplqqqqqmaqqpmqqqqpZqqqmWqqqqlaqqqlaqqqqlqqqqWqqqqqqqqqqqqqKqqqqqqqqqgqqqqqqqqqqAqqqqqqqqqgAqqqqqqqqoAAKqqqqqqoAA=="
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
/** System 7.5.3: System -3999 Folder · ics# (the 16×16 Apple drew for its folder, which icon/folder follows) */
const ICON_FOLDER_16X16 = defineSprite(
  16,
  16,
  "AAAAAAAAAAAAAAAACqAAACVYAACqqqqolVVVVpVVVVaVVVVWlVVVVpVVVVaVVVVWlVVVVpVVVVaVVVVWqqqqqg=="
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
/** System 7.5.3: System -3995 Hard Disk · ics# */
const ICON_HD_16X16 = defineSprite(
  16,
  16,
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAqqqqolVVVVpVVVVaZVVVWlVVVViqqqqgAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
);
/** System 7.5.3: System -3996 Application · ICN#: what the Finder shows for an app without an icon of its own. */
const ICON_APPLICATION = defineSprite(
  32,
  32,
  "AAAAAgAAAAAAAAAJgAAAAAAAACVgAAAAAAAAlVgAAAAAAAJVVgAAAAAACVVVgAAAAAAlVVVgAAAAAJVVVVgAAAACVVVVVgAAAAlVVVVVgAAAJVVVVVVgAACVVVVVVVgAAlVVVVVVVgAJVVVVVVVVgCVVVVVaqlVglVVVVWVVlVglVVVVlVVlVglVVVZaVVlYAlVVVqWVVmAAlVWpaqqVqgAlVVlaVVVqAAlVVlVVVWoAAlVVlVVVagAAlVVpVVVqAAAlVVaqqWoAAAlVVVgCqgAAAlVVYAAqAAAAlVWAAAAAAAAlVgAAAAAAAAlYAAAAAAAAAmAAAAAAAAAAgAAAAA=="
);
/** System 7.5.3: System -3996 Application · ics# */
const ICON_APPLICATION_16X16 = defineSprite(
  16,
  16,
  "AAAAAAACAAAACYAAACVgAACVWAACVVYACVVVgCVVaWCVVZZYJVZlqAlpqmgCVlVoAJWqqAAlYCgACYAAAAIAAA=="
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
/** System 7.5.3: System Trash -3993 · ICN# (the same can as icon/trash-full, empty) */
const ICON_TRASH = defineSprite(
  32,
  32,
  "AAAAKqgAAAAAAACVVgAAAAAKqqqqqqAAACVVVVVVWAAAKqqqqqqoAAAJVVVVVWAAAAlVVVVVYAAACWVlZWVgAAAJWVlZWWAAAAlZWVlZYAAACVlZWVlgAAAJWVlZWWAAAAlZWVlZYAAACVlZWVlgAAAJWVlZWWAAAAlZWVlZYAAACVlZWVlgAAAJWVlZWWAAAAlZWVlZYAAACVlZWVlgAAAJWVlZWWAAAAlZWVlZYAAACVlZWVlgAAAJWVlZWWAAAAlZWVlZYAAACVlZWVlgAAAJWVlZWWAAAAlZWVlZYAAACWVlZWVgAAAJVVVVVWAAAAlVVVVVYAAAAqqqqqqAAA=="
);
/** System 7.5.3: System Trash -3993 · ics# */
const ICON_TRASH_16X16 = defineSprite(
  16,
  16,
  "AAqAAAAgIAAqqqqgJVVVYCqqqqAJVVWACWZlgAlmZYAJZmWACWZlgAlmZYAJZmWACWZlgAlmZYAJVVWAAqqqAA=="
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
/** A picture document: the document page with a landscape photo where its text would be. */
const ICON_PICTURE = fromGrid(32, 32, [
  "...###################..........",
  "...#ooooooooooooooooo##.........",
  "...#ooooooooooooooooo#o#........",
  "...#ooooooooooooooooo#oo#.......",
  "...#ooooooooooooooooo#ooo#......",
  "...#ooooooooooooooooo#oooo#.....",
  "...#ooooooooooooooooo#######....",
  "...#ooooooooooooooooooooooo#....",
  "...#ooooooooooooooooooooooo#....",
  "...#ooooooooooooooooooooooo#....",
  "...#oo###################oo#....",
  "...#oo#ooooooooooooooooo#oo#....",
  "...#oo#oooooooooooo###oo#oo#....",
  "...#oo#oooooooooooo###oo#oo#....",
  "...#oo#oooooooooooo###oo#oo#....",
  "...#oo#oooooooooooo###oo#oo#....",
  "...#oo#ooooooooooooooooo#oo#....",
  "...#oo#ooooooooooooooooo#oo#....",
  "...#oo#ooooo#ooooooooooo#oo#....",
  "...#oo#oooo###oooooooooo#oo#....",
  "...#oo#oooo####ooooooooo#oo#....",
  "...#oo#ooo######ooo#oooo#oo#....",
  "...#oo#oo#######oo###ooo#oo#....",
  "...#oo#o###############o#oo#....",
  "...#oo#o#################oo#....",
  "...#oo###################oo#....",
  "...#oo###################oo#....",
  "...#ooooooooooooooooooooooo#....",
  "...#ooooooooooooooooooooooo#....",
  "...#ooooooooooooooooooooooo#....",
  "...#ooooooooooooooooooooooo#....",
  "...#########################....",
]);
/** The picture document for 16×16 views: the page and a small mountain. */
const ICON_PICTURE_16X16 = fromGrid(16, 16, [
  "..########......",
  "..#oooooo##.....",
  "..#oooooo#o#....",
  "..#oooooo#oo#...",
  "..#oooooo#####..",
  "..#oooooooooo#..",
  "..#o########o#..",
  "..#o#oooooo#o#..",
  "..#o#oooo#o#o#..",
  "..#o#oooooo#o#..",
  "..#o#oo#ooo#o#..",
  "..#o#o###oo#o#..",
  "..#o########o#..",
  "..#o########o#..",
  "..#oooooooooo#..",
  "..############..",
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
/** Black rounded square with a lit top edge and a white lens ring with one glint. */
const ICON_PHOTOBOOTH_SMR_32_16X16 = fromGrid(16, 16, [
  "..############..",
  ".##oooooooooo##.",
  "################",
  "######oooo######",
  "####ooo##ooo####",
  "###oo######oo###",
  "###o##oo####o###",
  "###o##oo####o###",
  "###o########o###",
  "###o########o###",
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
/** System 7.5.3: System Full Trash -3984 · ICN# */
const ICON_TRASH_FULL = defineSprite(
  32,
  32,
  "AAAAKqgAAAAAAACVVgAAAAAKqqqqqqAAACVVVVVVWAAAKqqqqqqoAAAJVVVVVWAAAAlVVVVVYAAACVZVVWVgAAAlWVlZWVgAACVZWVlZWAAAlWVlVlZWAACVZWVWVlYAAlWVlVWVlYACVZWVVZWVgAJVlZVVlZWAAlWVlVWVlYACVZWVVZWVgAJVlZVVlZWAAlWVlVWVlYACVZWVVZWVgAJVlZVVlZWAAlWVlVWVlYACVZWVVZWVgACVZWVWVlYAAJVlZVZWVgAAJVlZWVlYAAAlWVlZWVgAACVZWVlZWAAACVZVVVVgAAAJVVVVVWAAAAlVVVVVYAAAAqqqqqqAAA=="
);
/** System 7.5.3: System Full Trash -3984 · ics# */
const ICON_TRASH_FULL_16X16 = defineSprite(
  16,
  16,
  "AAqAAAAgIAAKqqqACVVVgAqqqoACVVYACWVlgAmWWYAllllgJZZZYCWWWWAllllgCZZZgAllZYACVVYAAKqoAA=="
);
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
  "icon/picture": ICON_PICTURE,
  "icon/picture-16x16": ICON_PICTURE_16X16,
  // Pictures saved before "icon/picture" stored this name as their icon.
  "icon/camera": ICON_PICTURE,
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
  "icon/folder-16x16": ICON_FOLDER_16X16,
  "icon/happy": ICON_HAPPY,
  "icon/hd": ICON_HD,
  "icon/hd-16x16": ICON_HD_16X16,
  "icon/application": ICON_APPLICATION,
  "icon/application-16x16": ICON_APPLICATION_16X16,
  "icon/movie": ICON_MOVIE,
  "icon/photobooth-32x32": ICON_PHOTOBOOTH_32X32,
  "icon/photobooth-smr-32": ICON_PHOTOBOOTH_SMR_32,
  "icon/photobooth-smr-32-16x16": ICON_PHOTOBOOTH_SMR_32_16X16,
  "icon/sad": ICON_SAD,
  "icon/stop": ICON_STOP,
  "icon/safari": ICON_SAFARI,
  "icon/safari-16x16": ICON_SAFARI_16X16,
  "icon/trash": ICON_TRASH,
  "icon/trash-16x16": ICON_TRASH_16X16,
  "icon/video": ICON_VIDEO,
  "foundry/icon": ICON_FOUNDRY_ICON,
  "icon/trash-full": ICON_TRASH_FULL,
  "icon/trash-full-16x16": ICON_TRASH_FULL_16X16,
};
