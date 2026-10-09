// ==UserScript==
// @name         YouTube AI 한국어 자막
// @namespace    local.youtube.ai.ko
// @version      0.1.10
// @updateURL    https://raw.githubusercontent.com/thgyu1004/youtube-ai-subtitles/main/youtube-ai-subtitles.meta.js
// @downloadURL  https://raw.githubusercontent.com/thgyu1004/youtube-ai-subtitles/main/youtube-ai-subtitles.user.js
// @author       J.S.Lee
// @description  자~막 — J.S.Lee의 AI 문맥 자막 / JaMak by J.S.Lee. 영상 맥락을 반영한 한국어 자막.
// @match        https://www.youtube.com/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @connect      www.youtube.com
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==