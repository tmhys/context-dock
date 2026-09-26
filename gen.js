/*
 * Context Dock の生成器。config（モード表）から次の2つを作る。
 *
 *   - Tasker のプロジェクト XML（ContextDock.prj.xml）
 *   - KWGT のプリセット（ContextDock.kwgt = preset.json とサムネイルの ZIP）
 *
 * このファイルが唯一の実装で、2か所から使う:
 *   - エディタ（index.html。GitHub Pages で公開）… スマホで編集してその場で作る
 *   - tmhys/my_apps の build.cjs（Node）… config.json が変わると Actions が作り直す
 * だから外部ライブラリは使わない（ZIP も PNG もここで書く）。
 * 設定データ（SSID など）はこのリポジトリには置かない。非公開の my_apps にある。
 *
 * Tasker XML の引数割り当ては Map-Tasker（https://github.com/mctinker/Map-Tasker）の
 * コード表と、tmhys/github_obsidian にあった日記プロジェクトの build.py に倣った。
 * KWGT の preset.json は公開プリセットを展開して突き合わせた（DESIGN.md 参照）。
 */
(function (root) {
  "use strict";

  var PROJECT = "ContextDock";
  var STAMP = "1790380800000"; // cdate/edate。実時刻である必要はない
  var REPO = "tmhys/my_apps";
  var PRJ_PATH = "apps/context-dock/ContextDock.prj.xml";
  var TOKEN_VAR = "%MYAPPS_TOKEN";
  var KWGT_PATH = "apps/context-dock/ContextDock.kwgt";
  var SAVE_TO = "Tasker/" + PROJECT + ".prj.xml";
  // KWGT はこのフォルダのプリセットを一覧に出す。置けばウィジェットから選べる。
  var KWGT_SAVE_TO = "Kustom/widgets/" + PROJECT + ".kwgt";
  // プロジェクトの外に手で作るタスク。プラグインアクションは XML に書けず、
  // プロジェクト内に置くと Import Project のたびに消えるので外に出す。
  var KWGT_TASK = "KWGT送信(ctx)";
  var JUDGE_TASK = "ctx判定";
  var FILES_PKG = "com.google.android.apps.nbu.files";
  var FILES_CLS = "com.google.android.apps.nbu.files.home.HomeActivity";

  var FLAG_VALUE = { wifi: "ssid", bt: "name", calendar: "title" };

  // ------------------------------------------------------------ 設定の検査

  /** 設定が有効なフラグ（SSID・BT名・タイトルが空でないもの）。 */
  function activeFlags(cfg) {
    var out = {};
    Object.keys(cfg.flags).forEach(function (k) {
      var f = cfg.flags[k];
      if (f[FLAG_VALUE[f.type]]) out[k] = f;
    });
    return out;
  }

  function normMode(m) {
    return {
      id: m.id, label: m.label, color: m.color,
      all: m.all || [], none: m.none || [],
      hours: m.hours || null, apps: m.apps
    };
  }

  /** Tasker に入れるモード。設定していないフラグに頼るモードは外す。 */
  function taskerModes(cfg) {
    var flags = activeFlags(cfg);
    return cfg.modes.filter(function (m) {
      return (m.all || []).concat(m.none || []).every(function (u) { return u in flags; });
    }).map(normMode);
  }

  /** 問題があれば日本語の文の配列で返す。空なら OK。 */
  function validate(cfg) {
    var errs = [];
    var ids = {};
    if (!cfg.modes || !cfg.modes.length) errs.push("モードが1つもありません");
    (cfg.modes || []).forEach(function (m, n) {
      var name = m.label || ("モード" + (n + 1));
      if (!m.id) errs.push(name + ": id が空です");
      if (ids[m.id]) errs.push(name + ": id「" + m.id + "」が重複しています");
      ids[m.id] = true;
      if (!/^#[0-9A-Fa-f]{6}$/.test(m.color || "")) errs.push(name + ": 色は #RRGGBB で指定します");
      if (/[;|"]/.test(m.label || "")) errs.push(name + ": モード名に ; | \" は使えません");
      if (!m.apps || m.apps.length !== 4) errs.push(name + ": アプリはちょうど4つにします");
      (m.apps || []).forEach(function (a) {
        if (/[;|]/.test(a[1] || "")) errs.push(name + ": 表示名「" + a[1] + "」に ; | は使えません");
        if (!a[0]) errs.push(name + ": アイコンが空のアプリがあります");
        if (/\n/.test(a[2] || "")) errs.push(name + ": 起動先に改行は使えません");
      });
      (m.all || []).concat(m.none || []).forEach(function (f) {
        if (!(f in cfg.flags)) errs.push(name + ": 未定義の条件「" + f + "」");
      });
      if (m.hours && (m.hours.length !== 2 || m.hours.some(function (h) { return !(h >= 0 && h <= 24); })))
        errs.push(name + ": 時間帯は 0〜24 時で指定します");
    });
    var last = (cfg.modes || [])[cfg.modes.length - 1];
    if (last && ((last.all || []).length || (last.none || []).length || last.hours))
      errs.push("いちばん下のモードは条件なしにします（どれにも当てはまらないとき用）");
    return errs;
  }

  // ------------------------------------------------------------ 判定（Tasker と同じ規則）

  /** Tasker の ctx判定 と同じ規則でモードを選ぶ。エディタの「試す」用。 */
  function judge(modes, on, hour) {
    function inHours(r) {
      if (!r) return true;
      return r[0] <= r[1] ? (hour >= r[0] && hour < r[1]) : (hour >= r[0] || hour < r[1]);
    }
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i];
      var ok = (m.all || []).every(function (f) { return on[f]; }) &&
               !(m.none || []).some(function (f) { return on[f]; });
      if (ok && inHours(m.hours)) return m;
    }
    return modes[modes.length - 1];
  }

  // ------------------------------------------------------------ Tasker XML

  function esc(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function s(n, v) {
    return v ? '<Str sr="arg' + n + '" ve="3">' + esc(v) + "</Str>" : '<Str sr="arg' + n + '" ve="3"/>';
  }
  function i(n, v) { return '<Int sr="arg' + n + '" val="' + (v || 0) + '"/>'; }
  function act(code, args, cont) {
    return "<code>" + code + "</code>" + (cont ? "<se>false</se>" : "") + args.join("");
  }

  function varSet(name, value) { return act(547, [s(0, name), s(1, value), i(2), i(3), i(4), i(5, 3), i(6)]); }
  function varClear(name) { return act(549, [s(0, name), i(1), i(2), i(3)]); }
  function perform(task, cont) {
    return act(130, [s(0, task), i(1, 5), s(2), s(3), s(4), i(5), i(6), s(7), i(8), i(9), i(10)], cont);
  }
  function js(code) { return act(129, [s(0, code), s(1), i(2, 1), i(3, 45)]); }
  function flash(text) {
    return act(548, [s(0, text), i(1, 1), i(2), s(3), s(4), s(5), s(6), s(7), s(8),
                     i(9, 1), s(10), i(11, 1), i(12), s(13), i(14), s(15)]);
  }
  function httpGet(url, headers, saveTo) {
    return act(339, [i(1), s(2, url), s(3, headers), s(4), s(5), s(6), s(7, saveTo),
                     i(8, 30), i(9), i(10, 1), i(11), i(12)]);
  }
  function launchApp(pkg, cls, label) {
    var app = '<App sr="arg0"><appClass>' + cls + "</appClass><appPkg>" + pkg +
              "</appPkg><label>" + esc(label) + "</label></App>";
    return act(20, [app, s(1), i(2), i(3), i(4)]);
  }

  // コンテキスト。コードは Map-Tasker の表から。
  function ctxWifi(ssid) { // State 160 Wifi Connected。arg3 Active: 0=Yes 1=No 2=Any
    return '<State sr="con0" ve="2"><code>160</code>' + s(0, ssid) + s(1) + s(2) + i(3, 2) + "</State>";
  }
  function ctxBt(name) { // State 3 BT Connected。Name に変数を入れると発火しない（既知の不具合）
    return '<State sr="con0" ve="2"><code>3</code>' + s(0, name) + s(1) + "</State>";
  }
  function ctxCalendar(title, early, late) { // State 5 Calendar Entry
    return '<State sr="con0" ve="2"><code>5</code>' + s(0, title) + s(1) + s(2) + s(3) + s(4) +
           i(5, early) + i(6, late) + "</State>";
  }
  function ctxDisplayOn() { // Event 208 Display On
    return '<Event sr="con0" ve="2"><code>208</code><pri>0</pri></Event>';
  }

  var JUDGE_JS = [
    "var MODES = __MODES__;",
    "function flag(n) { return global('CTX_' + n) == '1'; }",
    "var h = parseInt(String(global('TIME')).split('.')[0], 10);",
    "function inHours(r) {",
    "  if (!r) return true;",
    "  return r[0] <= r[1] ? (h >= r[0] && h < r[1]) : (h >= r[0] || h < r[1]);",
    "}",
    "var pick = MODES[MODES.length - 1];",
    "for (var i = 0; i < MODES.length; i++) {",
    "  var m = MODES[i], ok = true, j;",
    "  for (j = 0; j < m.all.length; j++) if (!flag(m.all[j])) ok = false;",
    "  for (j = 0; j < m.none.length; j++) if (flag(m.none[j])) ok = false;",
    "  if (ok && inHours(m.hours)) { pick = m; break; }",
    "}",
    "var disp = [pick.label + '|' + pick.color], targets = [];",
    "for (var k = 0; k < pick.apps.length; k++) {",
    "  disp.push(pick.apps[k][0] + '|' + pick.apps[k][1]);",
    "  targets.push(pick.apps[k][2]);",
    "}",
    "setGlobal('CTXMODE', pick.id);",
    "setGlobal('CTXDISP', disp.join(';'));",
    "setGlobal('CTXTARGETS', targets.join('\\n'));",
    ""
  ].join("\n");

  var SLOT_JS = [
    "var t = String(global('CTXTARGETS')).split('\\n')[__N__] || '';",
    "if (t.indexOf('://') > 0) browseURL(t);",
    "else if (t) loadApp(t, '', false);",
    ""
  ].join("\n");

  function buildXml(cfg) {
    var flags = activeFlags(cfg);
    var modes = taskerModes(cfg);
    var tasks = [], profiles = [], tid = 100, pid = 1;

    function addTask(name, actions) { tasks.push([tid, name, actions]); return tid++; }
    function addProfile(name, context, enter, exit) {
      profiles.push('<Profile sr="prof' + pid + '" ve="2"><cdate>' + STAMP + "</cdate><edate>" + STAMP +
        "</edate><id>" + pid + "</id><mid0>" + enter + "</mid0>" +
        (exit != null ? "<mid1>" + exit + "</mid1>" : "") + "<nme>" + esc(name) + "</nme>" + context + "</Profile>");
      pid++;
    }

    var judgeId = addTask(JUDGE_TASK, [
      js(JUDGE_JS.replace("__MODES__", JSON.stringify(modes))),
      // KWGT への受け渡しはプロジェクト外のタスクに任せる。未作成でも止まらない。
      perform(KWGT_TASK, true)
    ]);
    for (var n = 0; n < 4; n++) addTask("ctx_slot" + (n + 1), [js(SLOT_JS.replace("__N__", String(n)))]);
    addTask("ctx 状態を見る", [flash("モード: %CTXMODE\n" + Object.keys(flags).map(function (k) {
      return flags[k].label + ": %CTX_" + k;
    }).join("\n"))]);
    var rawHeaders = "Authorization:Bearer " + TOKEN_VAR + "\nAccept:application/vnd.github.raw";
    addTask(PROJECT + " 更新", [
      httpGet("https://api.github.com/repos/" + REPO + "/contents/" + PRJ_PATH + "?ref=main", rawHeaders, SAVE_TO),
      flash(SAVE_TO + " に保存 (%http_response_code)"),
      httpGet("https://api.github.com/repos/" + REPO + "/contents/" + KWGT_PATH + "?ref=main", rawHeaders, KWGT_SAVE_TO),
      flash(KWGT_SAVE_TO + " に保存 (%http_response_code)"),
      launchApp(FILES_PKG, FILES_CLS, "Files")
    ]);

    Object.keys(flags).forEach(function (k) {
      var f = flags[k], v = "%CTX_" + k;
      var on = addTask("ctx " + f.label + " ON", [varSet(v, "1"), perform(JUDGE_TASK)]);
      var off = addTask("ctx " + f.label + " OFF", [varClear(v), perform(JUDGE_TASK)]);
      var context = f.type === "wifi" ? ctxWifi(f.ssid)
                  : f.type === "bt" ? ctxBt(f.name)
                  : ctxCalendar(f.title, f.early || 0, f.late || 0);
      addProfile("ctx " + f.label, context, on, off);
    });
    // 時間帯の切り替わりは、画面をつけた瞬間に拾う。定期実行より電池に優しい。
    addProfile("ctx 画面オン", ctxDisplayOn(), judgeId);

    var pids = [];
    for (var p = 1; p < pid; p++) pids.push(p);
    return '<TaskerData sr="" dvi="1" tv="6.3.13">\n' +
      '<Project sr="proj0" ve="2"><cdate>' + STAMP + "</cdate><name>" + PROJECT + "</name>" +
      "<pids>" + pids.join(",") + "</pids><tids>" + tasks.map(function (t) { return t[0]; }).join(",") +
      "</tids></Project>\n" +
      profiles.join("\n") + "\n" +
      tasks.map(function (t) {
        var body = t[2].map(function (a, n) { return '<Action sr="act' + n + '" ve="7">' + a + "</Action>"; }).join("");
        return '<Task sr="task' + t[0] + '"><cdate>' + STAMP + "</cdate><edate>" + STAMP + "</edate><id>" +
          t[0] + "</id><nme>" + esc(t[1]) + "</nme><pri>10</pri>" + body + "</Task>\n";
      }).join("") +
      "</TaskerData>\n";
  }

  // ------------------------------------------------------------ KWGT プリセット

  var SOURCE = "Tasker"; // $br(Tasker, ctx)$ の第1引数。プラグインが名乗る送り主の名前
  var BG = "#FF1C1C1E", TILE = "#FF2A2A2D", LABEL = "#FFC7C7CC", MUTED = "#FF8E8E93";
  var PAD = 14, GAP = 10, HEAD = 16;
  // 大きさはウィジェットの実寸から数式で決める。2×2 以外に置いても崩れない。
  var SIDE = "mu(min, (si(rwidth)-" + (PAD * 2 + GAP) + ")/2, (si(rheight)-" + (PAD * 2 + GAP * 2 + HEAD) + ")/2)";
  var TILE_SIZE = "$" + SIDE + "$";
  var ICON_SIZE = "$" + SIDE + "*0.38$";
  var LABEL_SIZE = "$" + SIDE + "*0.15$";
  var HEAD_OF_CTX = 'tc(split, br(' + SOURCE + ', ctx), "|", 0)';

  function argb(hex) {
    var h = hex.replace("#", "").toUpperCase();
    return h.length === 6 ? "#FF" + h : "#" + h;
  }

  /** パッケージ名だけでランチャー画面を開く intent。クラス名は端末で変わりうるので書かない。 */
  function launch(pkg, label) {
    if (!pkg || pkg.indexOf(".") < 0 || pkg.indexOf("://") >= 0) return [];
    return [{
      action: "LAUNCH_APP",
      intent: "intent:#Intent;action=android.intent.action.MAIN;" +
              "category=android.intent.category.LAUNCHER;launchFlags=0x10000000;" +
              "package=" + pkg + ";S.org.kustom.intent.label=" + encodeURIComponent(label) + ";end",
      type: "SINGLE_TAP"
    }];
  }

  function tile(app, color) {
    var icon = app[0], label = app[1], pkg = app[2];
    return {
      internal_type: "OverlapLayerModule",
      internal_title: label,
      internal_events: launch(pkg, label),
      viewgroup_items: [
        {
          internal_type: "ShapeModule", internal_title: "Tile", shape_type: "RECT",
          shape_width: 68, shape_height: 68, shape_corners: 20, paint_color: TILE,
          internal_toggles: { shape_width: 10, shape_height: 10 },
          internal_formulas: { shape_width: TILE_SIZE, shape_height: TILE_SIZE }
        },
        {
          internal_type: "StackLayerModule", internal_title: "Icon+Label",
          config_stacking: "VERTICAL_CENTER", config_margin: 4,
          viewgroup_items: [
            {
              internal_type: "FontIconModule", internal_title: "Icon", icon_icon: icon, icon_size: 26,
              paint_color: argb(color),
              internal_toggles: { icon_size: 10 }, internal_formulas: { icon_size: ICON_SIZE }
            },
            {
              internal_type: "TextModule", internal_title: "Label", text_expression: label,
              text_size: 10, text_align: "CENTER", paint_color: LABEL,
              internal_toggles: { text_size: 10 }, internal_formulas: { text_size: LABEL_SIZE }
            }
          ]
        }
      ]
    };
  }

  function row(apps, color) {
    return {
      internal_type: "StackLayerModule", internal_title: "Row",
      config_stacking: "HORIZONTAL_CENTER", config_margin: GAP,
      viewgroup_items: apps.map(function (a) { return tile(a, color); })
    };
  }

  function modeGroup(m, fallback) {
    var shown = HEAD_OF_CTX + '="' + m.label + '"';
    if (fallback) shown += " | br(" + SOURCE + ', ctx)=""'; // Tasker からまだ何も届いていないとき
    return {
      internal_type: "StackLayerModule", internal_title: "Mode " + m.id,
      config_stacking: "VERTICAL_CENTER", config_margin: GAP,
      internal_toggles: { config_visible: 10 },
      internal_formulas: { config_visible: "$if(" + shown + ", ALWAYS, NEVER)$" },
      viewgroup_items: [
        {
          internal_type: "StackLayerModule", internal_title: "Header",
          config_stacking: "HORIZONTAL_CENTER", config_margin: 6,
          viewgroup_items: [
            { internal_type: "ShapeModule", internal_title: "Dot", shape_type: "CIRCLE",
              shape_width: 6, shape_height: 6, paint_color: argb(m.color) },
            { internal_type: "TextModule", internal_title: "Mode", text_expression: m.label,
              text_size: 11, paint_color: MUTED }
          ]
        },
        row(m.apps.slice(0, 2), m.color),
        row(m.apps.slice(2), m.color)
      ]
    };
  }

  /** KWGT には全モードを入れる。フラグ未設定のモードは Tasker が選ばないので出てこないだけ。 */
  function buildPreset(cfg) {
    var modes = cfg.modes;
    return {
      preset_info: {
        version: 13, title: "Context Dock",
        description: "状況に応じてアプリ4つを出し分ける。Tasker の ContextDock プロジェクトと組で使う",
        author: "tmhys", width: 400, height: 400, features: "", release: 1, locked: false, pflags: 0
      },
      preset_root: {
        internal_type: "RootLayerModule",
        viewgroup_items: [{
          internal_type: "ShapeModule", internal_title: "Background", shape_type: "RECT",
          shape_width: 400, shape_height: 400, shape_corners: 28, paint_color: BG,
          internal_toggles: { shape_width: 10, shape_height: 10 },
          internal_formulas: { shape_width: "$si(rwidth)$", shape_height: "$si(rheight)$" }
        }].concat(modes.map(function (m, n) { return modeGroup(m, n === modes.length - 1); }))
      }
    };
  }

  // ------------------------------------------------------------ バイナリ（ZIP・PNG）

  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, "utf8")); // 古い Node 用
  }

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes, start) {
    var c = start === undefined ? 0xFFFFFFFF : start;
    for (var n = 0; n < bytes.length; n++) c = CRC_TABLE[(c ^ bytes[n]) & 0xFF] ^ (c >>> 8);
    return c;
  }
  function crc(bytes) { return (crc32(bytes) ^ 0xFFFFFFFF) >>> 0; }

  function concat(parts) {
    var len = parts.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(len), off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.length; });
    return out;
  }
  function le(n, bytes) {
    var a = new Uint8Array(bytes);
    for (var k = 0; k < bytes; k++) a[k] = (n >>> (8 * k)) & 0xFF;
    return a;
  }
  function be32(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }

  /** 無圧縮（stored）の ZIP。日時は固定して、中身が同じなら同じバイト列になるようにする。 */
  function zip(files) {
    var DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01 00:00
    var locals = [], centrals = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name), data = f.data, c = crc(data);
      var head = concat([le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(DOS_TIME, 2), le(DOS_DATE, 2),
                         le(c, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), name]);
      centrals.push(concat([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(DOS_TIME, 2),
                            le(DOS_DATE, 2), le(c, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2),
                            le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), name]));
      locals.push(head, data);
      offset += head.length + data.length;
    });
    var dir = concat(centrals);
    var end = concat([le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2),
                      le(dir.length, 4), le(offset, 4), le(0, 2)]);
    return concat(locals.concat([dir, end]));
  }

  /** 無圧縮ブロックだけの zlib ストリーム（PNG の IDAT 用）。 */
  function zlibStored(data) {
    var parts = [new Uint8Array([0x78, 0x01])];
    for (var off = 0; off < data.length || off === 0; off += 65535) {
      var chunk = data.subarray(off, Math.min(off + 65535, data.length));
      var last = off + 65535 >= data.length ? 1 : 0;
      parts.push(new Uint8Array([last]), le(chunk.length, 2), le(~chunk.length & 0xFFFF, 2), chunk);
      if (last) break;
    }
    var a = 1, b = 0;
    for (var n = 0; n < data.length; n++) { a = (a + data[n]) % 65521; b = (b + a) % 65521; }
    parts.push(be32(((b << 16) | a) >>> 0));
    return concat(parts);
  }

  /** 一覧に出す小さな絵。拡張子は jpg だが Android は中身（PNG）で読む。 */
  function thumbnail(color) {
    var size = 120, bg = [0x1C, 0x1C, 0x1E], tl = [0x2A, 0x2A, 0x2D];
    var h = (color || "#FF6B1A").replace("#", "");
    var dot = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    var t = (size - 2 * 12 - 8) >> 1;
    var raw = new Uint8Array(size * (size * 3 + 1));
    for (var y = 0; y < size; y++) {
      var o = y * (size * 3 + 1);
      raw[o] = 0;
      for (var x = 0; x < size; x++) {
        var px = bg;
        if (x >= 12 && x < 16 && y >= 12 && y < 16) px = dot;
        for (var r = 0; r < 2; r++) for (var c = 0; c < 2; c++) {
          var bx = 12 + c * (t + 8), by = 22 + r * (t + 8);
          if (x >= bx && x < bx + t && y >= by && y < by + t - 10) px = tl;
        }
        raw.set(px, o + 1 + x * 3);
      }
    }
    function chunk(type, data) {
      var td = concat([utf8(type), data]);
      return concat([be32(data.length), td, be32(crc(td))]);
    }
    var ihdr = concat([be32(size), be32(size), new Uint8Array([8, 2, 0, 0, 0])]);
    return concat([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
                   chunk("IHDR", ihdr), chunk("IDAT", zlibStored(raw)), chunk("IEND", new Uint8Array(0))]);
  }

  function buildKwgt(cfg) {
    var thumb = thumbnail(cfg.modes[0] && cfg.modes[0].color);
    return zip([
      { name: "preset.json", data: utf8(JSON.stringify(buildPreset(cfg), null, 1)) },
      { name: "preset_thumb_portrait.jpg", data: thumb },
      { name: "preset_thumb_landscape.jpg", data: thumb }
    ]);
  }

  /** スマホで1回保存すれば済むよう、XML と .kwgt を1つの ZIP にまとめる。 */
  function buildBundle(cfg) {
    return zip([
      { name: PROJECT + ".prj.xml", data: utf8(buildXml(cfg)) },
      { name: PROJECT + ".kwgt", data: buildKwgt(cfg) }
    ]);
  }

  var api = {
    activeFlags: activeFlags, taskerModes: taskerModes, validate: validate, judge: judge,
    buildXml: buildXml, buildPreset: buildPreset, buildKwgt: buildKwgt, buildBundle: buildBundle,
    JUDGE_JS: JUDGE_JS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ContextDockGen = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
