//! Fixed provider-bridge scripts constructed exclusively in native Rust.
//! IPC supplies only allowlisted action names, numeric IDs, and JSON-encoded text.
//! These pure helpers are exercised by the existing webviews security tests.

pub(super) const CHATGPT_BRIDGE_PEEK_JS: &str =
    "window.__MAC_BRIDGE__ ? window.__MAC_BRIDGE__.peekOutbox() : []";
pub(super) const CHATGPT_BRIDGE_ACK_PREFIX: &str =
    "window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.ackBulk(";
// Exact, read-only probe used only to distinguish a present bridge/engine
// from a successful native eval into a document with no injected bridge.
pub(super) const CHATGPT_BRIDGE_HEALTH_JS: &str =
    r#"(function(){var b=window.__MAC_BRIDGE__;var e=window.__MAC_ENGINE__;var d=b&&b.diagnostics;var n=function(v){return Number.isSafeInteger(v)&&v>=0?v:null};var p=function(v){return typeof v==="string"&&/^(?:waiting-user-anchor|assistant-selector-missing|candidate-rejected|completion-turn-missing|completion-marker-missing|completion-marker-present|diagnostics-error)$/.test(v)?v:null};return {bridgePresent:!!b,enginePresent:!!e,bootMatches:!!b&&!!e&&b.bootId===e.bootId,adapterInstalled:!!e&&typeof e.adapterVersion==="number"&&e.adapterVersion>0,statusTicks:!!e?n(e.statusTicks):null,responsePollTicks:!!e?n(e.responsePollTicks):null,engineAwaiting:!!e&&e.waitingForResponse===true,statusEmits:!!e?n(e.statusEmits):null,fillStarts:!!e?n(e.fillStarts):null,fillDones:!!e?n(e.fillDones):null,titleQueued:!!d?n(d.queued):null,titleStarted:!!d?n(d.started):null,titleFinished:!!d?n(d.finished):null,capturePhase:!!e?p(e.capturePhase):null,captureResponseNodes:!!e?n(e.captureResponseNodes):null,captureAssistantUnits:!!e?n(e.captureAssistantUnits):null,captureLatestUnitDomChars:!!e?n(e.captureLatestUnitDomChars):null,captureTextChars:!!e?n(e.captureTextChars):null,captureAnchor:!!e&&e.captureAnchor===true,captureGenerationSeen:!!e&&e.captureGenerationSeen===true};})()"#;

// Native scripts are fixed by Cogitor, never supplied by frontend IPC.
// The control pane may select semantic actions and pass plain user text or
// a numeric acknowledgement ID, but cannot supply JavaScript source.
pub(super) fn build_provider_control_script(
    provider: &str,
    action: &str,
    text: Option<&str>,
    mid: Option<u64>,
) -> Result<String, String> {
    match action {
        "send" | "fill" => {
            if mid.is_some() {
                return Err("message actions must not include an acknowledgement".into());
            }
            let body = text.ok_or_else(|| "message text is required".to_string())?;
            if body.len() > 1024 * 1024 {
                return Err("message text exceeds the 1 MiB native IPC limit".into());
            }
            let command = if action == "send" { "SEND_MESSAGE" } else { "FILL_DRAFT" };
            let data = serde_json::json!({
                "v": 1,
                "action": command,
                "provider": provider,
                "payload": { "text": body },
            });
            Ok(format!("window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch({data});"))
        }
        "stop" if text.is_none() && mid.is_none() => Ok(
            "window.__MAC_ENGINE__ && typeof window.__MAC_ENGINE__.stop === 'function' && window.__MAC_ENGINE__.stop();".into()
        ),
        "ack" if text.is_none() => {
            let value = mid.ok_or_else(|| "acknowledgement ID required".to_string())?;
            if value == 0 || value > 9_007_199_254_740_991 {
                return Err("invalid acknowledgement ID".into());
            }
            Ok(format!("{CHATGPT_BRIDGE_ACK_PREFIX}{value});"))
        }
        _ => Err("unsupported provider control action".into()),
    }
}

pub(super) fn provider_bridge_read_script(kind: &str) -> Result<&'static str, String> {
    match kind {
        "peek" => Ok(CHATGPT_BRIDGE_PEEK_JS),
        "health" => Ok(CHATGPT_BRIDGE_HEALTH_JS),
        _ => Err("unsupported bridge read".into()),
    }
}

