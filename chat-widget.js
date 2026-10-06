(function () {
  "use strict";

  var DEFAULT_CONFIG = {
    apiEndpoint: "",
    unityGameObject: "BIMController",
    unityMethod: "HighlightElements",
    buildingId: null,
    buildingVersion: null,
  };

  var CONFIG = Object.assign({}, DEFAULT_CONFIG, window.BIMChatWidgetConfig || {});

  var params = new URLSearchParams(window.location.search);
  var buildingId = CONFIG.buildingId || params.get("building_id") || params.get("id");
  var buildingVersion = CONFIG.buildingVersion || params.get("v");

  // Unity may still be loading on the first answer
  var pendingHighlight = null;

  function highlightElementsInViewer(elementIds) {
    if (!elementIds || elementIds.length === 0) return;

    if (window.unityInstance && typeof window.unityInstance.SendMessage === "function") {
      window.unityInstance.SendMessage(
        CONFIG.unityGameObject,
        CONFIG.unityMethod,
        elementIds.join(",")
      );
      pendingHighlight = null;
    } else {
      console.warn(
        "[BIMChatWidget] window.unityInstance ยังไม่พร้อม — เก็บ elementID ไว้รอ highlight ทีหลัง",
        elementIds
      );
      pendingHighlight = elementIds;
    }
  }

  // poll for Unity, give up after ~30s
  var retryCount = 0;
  var retryTimer = setInterval(function () {
    retryCount++;
    if (pendingHighlight) {
      highlightElementsInViewer(pendingHighlight);
    }
    if (!pendingHighlight || retryCount > 30) {
      clearInterval(retryTimer);
    }
  }, 1000);

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInline(text) {
    text = escapeHtml(text); // escape before applying markdown - source is untrusted
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });
    return text;
  }

  function renderMarkdown(src) {
    var lines = src.replace(/\r\n/g, "\n").split("\n");
    var html = "";
    var i = 0;
    var listBuffer = null;

    function closeList() {
      if (listBuffer) {
        html += listBuffer === "ul" ? "</ul>" : "</ol>";
        listBuffer = null;
      }
    }

    while (i < lines.length) {
      var line = lines[i];

      var fence = line.match(/^```(.*)$/);
      if (fence) {
        closeList();
        var codeLines = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        html += "<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>";
        continue;
      }

      var heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        var level = heading[1].length;
        html += "<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">";
        i++;
        continue;
      }

      var ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ul) {
        if (listBuffer !== "ul") {
          closeList();
          html += "<ul>";
          listBuffer = "ul";
        }
        html += "<li>" + renderInline(ul[1]) + "</li>";
        i++;
        continue;
      }

      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        if (listBuffer !== "ol") {
          closeList();
          html += "<ol>";
          listBuffer = "ol";
        }
        html += "<li>" + renderInline(ol[1]) + "</li>";
        i++;
        continue;
      }

      closeList();

      if (line.trim() === "") {
        i++;
        continue;
      }

      html += "<p>" + renderInline(line) + "</p>";
      i++;
    }
    closeList();
    return html;
  }

  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 4v-4H6a2 2 0 0 1-2-2V6Z" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<circle cx="8.5" cy="10.5" r="1" fill="currentColor"/>' +
    '<circle cx="12" cy="10.5" r="1" fill="currentColor"/>' +
    '<circle cx="15.5" cy="10.5" r="1" fill="currentColor"/>' +
    "</svg>";

  var ICON_SEND =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3.4 11.9 20 4l-6.8 17-2.7-7.1L3.4 11.9Z" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
    "</svg>";

  var style = document.createElement("style");
  style.textContent = [
    "#bim-chat-toggle{position:fixed;right:20px;bottom:20px;width:60px;height:60px;",
    "box-sizing:border-box;border-radius:50%;border:3px solid #de5c8e;",
    "background:#fff;",
    "color:#374151;display:flex;align-items:center;justify-content:center;padding:0;",
    "cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.25);z-index:99999;}",
    "#bim-chat-toggle svg{width:26px;height:26px;}",

    "#bim-chat-panel{--bim-scale:1;position:fixed;right:20px;bottom:92px;",
    "width:calc(340px * var(--bim-scale));max-width:92vw;",
    "height:calc(460px * var(--bim-scale));max-height:80vh;box-sizing:border-box;border-radius:18px;",
    "border:2px solid #de5c8e;",
    "background:#fff;",
    "box-shadow:0 10px 34px rgba(0,0,0,.22);display:none;flex-direction:column;",
    "overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;z-index:99999;}",
    "#bim-chat-panel.open{display:flex;}",

    "#bim-chat-header{background:#fff;color:#111827;padding:14px 16px 12px;",
    "display:flex;align-items:center;gap:6px;border-bottom:1px solid #f1f2f4;flex:none;}",
    "#bim-chat-header-icon{width:32px;height:32px;border-radius:50%;flex:none;",
    "background:linear-gradient(135deg,#fde2f3,#fff);display:flex;align-items:center;",
    "justify-content:center;font-size:16px;}",
    "#bim-chat-header-title{font-weight:700;font-size:14px;flex:1;",
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",

    "#bim-chat-font-dec,#bim-chat-font-inc{flex:none;width:26px;height:26px;border-radius:50%;",
    "border:1px solid #e5e7eb;background:#fff;color:#4b5563;cursor:pointer;font-weight:700;",
    "display:flex;align-items:center;justify-content:center;font-size:12px;padding:0;",
    "font-family:inherit;line-height:1;}",
    "#bim-chat-font-dec:hover,#bim-chat-font-inc:hover{background:#f9fafb;}",
    "#bim-chat-font-dec:disabled,#bim-chat-font-inc:disabled{opacity:.35;cursor:default;}",

    "#bim-chat-close{flex:none;background:none;border:none;color:#9ca3af;font-size:16px;",
    "cursor:pointer;line-height:1;padding:2px;}",
    "#bim-chat-close:hover{color:#4b5563;}",

    "#bim-chat-messages{flex:1;overflow-y:auto;padding:14px 16px;background:#fff;",
    "display:flex;flex-direction:column;gap:10px;}",

    ".bim-msg{max-width:88%;padding:calc(9px * var(--bim-scale)) calc(13px * var(--bim-scale));",
    "border-radius:14px;font-size:calc(13px * var(--bim-scale));",
    "line-height:1.55;word-break:break-word;animation:bim-msg-in .18s ease-out;}",
    "@keyframes bim-msg-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}",
    ".bim-msg.user{align-self:flex-end;background:linear-gradient(135deg,#ec4899,#de5c8e);",
    "color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap;}",
    ".bim-msg.bot{align-self:flex-start;background:#f9fafb;color:#111827;",
    "border:1px solid #eef0f2;border-bottom-left-radius:4px;}",
    ".bim-msg.error{align-self:flex-start;background:#fee2e2;color:#991b1b;",
    "border:1px solid #fecaca;}",
    ".bim-msg.hint{align-self:center;background:transparent;color:#9ca3af;",
    "font-size:calc(11px * var(--bim-scale));text-align:center;}",

    ".bim-msg.bot p{margin:0 0 6px;}",
    ".bim-msg.bot p:last-child{margin-bottom:0;}",
    ".bim-msg.bot ul,.bim-msg.bot ol{margin:4px 0 6px;padding-left:20px;}",
    ".bim-msg.bot li{margin:2px 0;}",
    ".bim-msg.bot h1,.bim-msg.bot h2,.bim-msg.bot h3,.bim-msg.bot h4,.bim-msg.bot h5,.bim-msg.bot h6{",
    "margin:6px 0 4px;font-size:1em;font-weight:700;}",
    ".bim-msg.bot h1:first-child,.bim-msg.bot h2:first-child,.bim-msg.bot h3:first-child{margin-top:0;}",
    ".bim-msg.bot code{background:#eef0f2;border-radius:4px;padding:1px 5px;",
    "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;}",
    ".bim-msg.bot pre{background:#111827;color:#e5e7eb;border-radius:8px;padding:10px 12px;",
    "overflow-x:auto;margin:4px 0 6px;}",
    ".bim-msg.bot pre code{background:none;padding:0;color:inherit;}",
    ".bim-msg.bot a{color:#db2777;text-decoration:underline;}",
    ".bim-msg.bot strong{font-weight:700;}",

    ".bim-typing{display:inline-flex;align-items:center;gap:3px;padding:2px 0;}",
    ".bim-typing span{width:6px;height:6px;border-radius:50%;background:#c7cbd1;",
    "animation:bim-typing-bounce 1.1s infinite ease-in-out;}",
    ".bim-typing span:nth-child(2){animation-delay:.15s;}",
    ".bim-typing span:nth-child(3){animation-delay:.3s;}",
    "@keyframes bim-typing-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}",
    "30%{transform:translateY(-4px);opacity:1;}}",

    "#bim-chat-inputrow{display:flex;align-items:flex-end;padding:12px;gap:8px;",
    "border-top:1px solid #f1f2f4;background:#fff;flex:none;}",
    "#bim-chat-input{flex:1;min-height:calc(38px * var(--bim-scale));",
    "max-height:calc(120px * var(--bim-scale));box-sizing:border-box;overflow-y:auto;",
    "border:1px solid #e5e7eb;border-radius:18px;padding:9px 16px;",
    "font-size:calc(13px * var(--bim-scale));line-height:1.4;resize:none;",
    "font-family:inherit;scrollbar-width:thin;scrollbar-color:#e5e7eb transparent;}",
    "#bim-chat-input::-webkit-scrollbar{width:4px;}",
    "#bim-chat-input::-webkit-scrollbar-track{background:transparent;}",
    "#bim-chat-input::-webkit-scrollbar-thumb{background:#e5e7eb;border-radius:4px;}",
    "#bim-chat-input:focus{outline:none;border-color:#f9a8d4;}",
    "#bim-chat-send{width:calc(38px * var(--bim-scale));height:calc(38px * var(--bim-scale));",
    "flex:none;border-radius:50%;border:none;",
    "background:linear-gradient(135deg,#ec4899,#de5c8e);color:#fff;",
    "display:flex;align-items:center;justify-content:center;",
    "box-shadow:0 3px 8px rgba(222,92,142,.45);cursor:pointer;",
    "transition:transform .12s ease,box-shadow .12s ease;}",
    "#bim-chat-send:hover{transform:translateY(-1px);box-shadow:0 5px 12px rgba(222,92,142,.55);}",
    "#bim-chat-send:active{transform:translateY(0);}",
    "#bim-chat-send:disabled{opacity:.5;cursor:default;box-shadow:none;transform:none;}",
    "#bim-chat-send svg{width:40%;height:40%;}",

    "#bim-chat-disclaimer{flex:none;text-align:center;color:#9ca3af;",
    "font-size:calc(10px * var(--bim-scale));line-height:1.4;padding:0 16px 10px;background:#fff;}",
  ].join("");
  document.head.appendChild(style);

  var toggleBtn = document.createElement("button");
  toggleBtn.id = "bim-chat-toggle";
  toggleBtn.type = "button";
  toggleBtn.innerHTML = ICON_CHAT;
  toggleBtn.setAttribute("aria-label", "เปิดแชทถามข้อมูลอาคาร");

  var panel = document.createElement("div");
  panel.id = "bim-chat-panel";
  panel.innerHTML =
    '<div id="bim-chat-header">' +
    '<span id="bim-chat-header-icon">🤖</span>' +
    '<span id="bim-chat-header-title">BIM Ai Assistant</span>' +
    '<button id="bim-chat-font-dec" type="button" aria-label="ลดขนาดตัวอักษรและหน้าต่างแชท">ก−</button>' +
    '<button id="bim-chat-font-inc" type="button" aria-label="เพิ่มขนาดตัวอักษรและหน้าต่างแชท">ก+</button>' +
    '<button id="bim-chat-close" type="button" aria-label="ปิด">✕</button></div>' +
    '<div id="bim-chat-messages"></div>' +
    '<div id="bim-chat-inputrow">' +
    '<textarea id="bim-chat-input" rows="1" placeholder="พิมพ์คำถาม เช่น ห้อง 101 อยู่ไหน?"></textarea>' +
    '<button id="bim-chat-send" type="button" aria-label="ส่ง">' + ICON_SEND + "</button>" +
    "</div>" +
    '<div id="bim-chat-disclaimer">คำตอบจาก AI อาจไม่ถูกต้องเสมอไป กรุณาตรวจสอบข้อมูลอีกครั้ง</div>';

  document.body.appendChild(toggleBtn);
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector("#bim-chat-messages");
  var inputEl = panel.querySelector("#bim-chat-input");
  var sendBtn = panel.querySelector("#bim-chat-send");
  var closeBtn = panel.querySelector("#bim-chat-close");
  var fontDecBtn = panel.querySelector("#bim-chat-font-dec");
  var fontIncBtn = panel.querySelector("#bim-chat-font-inc");

  var SIZE_SCALES = [1, 1.25, 1.55];
  var SIZE_LEVEL_KEY = "bim-chat-size-level";
  var sizeLevel = 0;
  try {
    var savedLevel = parseInt(localStorage.getItem(SIZE_LEVEL_KEY), 10);
    if (savedLevel >= 0 && savedLevel < SIZE_SCALES.length) sizeLevel = savedLevel;
  } catch (e) {} // private mode can block localStorage

  function applySizeScale() {
    panel.style.setProperty("--bim-scale", SIZE_SCALES[sizeLevel]);
    fontDecBtn.disabled = sizeLevel === 0;
    fontIncBtn.disabled = sizeLevel === SIZE_SCALES.length - 1;
    try {
      localStorage.setItem(SIZE_LEVEL_KEY, String(sizeLevel));
    } catch (e) {}
  }
  applySizeScale();

  fontDecBtn.addEventListener("click", function () {
    sizeLevel = Math.max(0, sizeLevel - 1);
    applySizeScale();
  });
  fontIncBtn.addEventListener("click", function () {
    sizeLevel = Math.min(SIZE_SCALES.length - 1, sizeLevel + 1);
    applySizeScale();
  });

  function addMessage(text, cls) {
    var div = document.createElement("div");
    div.className = "bim-msg " + cls;
    if (cls === "bot") {
      div.innerHTML = renderMarkdown(text);
    } else {
      div.textContent = text;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function setBotText(div, text) {
    div.innerHTML = renderMarkdown(text);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addTypingIndicator() {
    var div = document.createElement("div");
    div.className = "bim-msg bot";
    div.innerHTML = '<span class="bim-typing"><span></span><span></span><span></span></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  addMessage(
    "สวัสดีครับ 👋 ผมคือ BIM AI Assistant เชื่อมต่อกับโมเดล BIM ของอาคารนี้อยู่ " +
      "จะถามหาห้อง สถานะอุปกรณ์ หรือเรื่องโครงสร้างอาคารก็พิมพ์มาได้เลยครับ",
    "bot"
  );

  if (!buildingId) {
    addMessage(
      "ไม่พบรหัสอาคารใน URL — เปิดหน้านี้ผ่านลิงก์ที่มี ?building_id=<building_id> เพื่อให้แชทค้นหาอาคารที่ถูกต้อง",
      "hint"
    );
  }
  if (!CONFIG.apiEndpoint) {
    addMessage(
      "ยังไม่ได้ตั้งค่า apiEndpoint — ใส่ URL ของ query-lambda ใน window.BIMChatWidgetConfig ก่อนใช้งานจริง",
      "hint"
    );
  }

  toggleBtn.addEventListener("click", function () {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) inputEl.focus();
  });
  closeBtn.addEventListener("click", function () {
    panel.classList.remove("open");
  });

  async function askQuestion(question) {
    var url =
      CONFIG.apiEndpoint +
      "?id=" + encodeURIComponent(buildingId || "") +
      "&v=" + encodeURIComponent(buildingVersion || "") +
      "&question=" + encodeURIComponent(question);

    var res = await fetch(url);
    var text = await res.text();

    // Lambda body is JSON-stringified twice through API Gateway sometimes
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("รูปแบบคำตอบจากเซิร์ฟเวอร์ไม่ถูกต้อง: " + text.slice(0, 200));
    }
    if (data.statusCode && data.statusCode !== 200) {
      throw new Error(data.body || "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์");
    }
    return data;
  }

  function autoGrowInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = inputEl.scrollHeight + "px";
  }
  inputEl.addEventListener("input", autoGrowInput);

  async function handleSend() {
    var question = inputEl.value.trim();
    if (!question) return;

    addMessage(question, "user");
    inputEl.value = "";
    autoGrowInput();
    sendBtn.disabled = true;
    var loadingEl = addTypingIndicator();

    try {
      var data = await askQuestion(question);
      setBotText(loadingEl, data.humanAnswer || "หาไม่เจอเลยครับ ลองถามอีกแบบดูไหม?");

      var ids = data.listOfElementID || [];
      if (ids.length > 0) {
        highlightElementsInViewer(ids);
      }
    } catch (err) {
      loadingEl.remove();
      addMessage("เกิดข้อผิดพลาด: " + err.message, "error");
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", handleSend);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  window.BIMChatWidget = {
    ask: function (question) {
      inputEl.value = question;
      handleSend();
    },
    highlightElementsInViewer: highlightElementsInViewer,
  };
})();
