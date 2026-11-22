/**
 * ai-assistant: ask a model you choose about the drawing, with your own key. Off until you turn it
 * on in Settings, Plugins. Nothing loads before that. Requests are sent by the app (`ctx.net`), the
 * key is kept by the app (`ctx.secret`) and cannot be read back, and Offline mode is respected.
 */
import { definePlugin } from "@vaultdraw/api";

import css from "./ai.css";
import Panel from "./Panel";
import { createSession } from "./session";

export default definePlugin({
  activate(ctx) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    ctx.subscriptions.push({ dispose: () => style.remove() });

    const session = createSession(ctx);
    ctx.panels.register("assistant", () => <Panel session={session} />);

    const open = (target?: "key") => {
      ctx.panels.open("assistant");
      session.focus(target);
    };
    /** A ready request through the one assistant (Describe, Summarise). */
    const ask = (request: string) => {
      open();
      void session.run(request);
    };

    ctx.commands.register("describe", () => {
      if (ctx.scene.selection().length === 0) {
        ctx.ui.toast("Select something in the drawing first");
        return;
      }
      ask("Describe what is selected, in a few plain sentences.");
    });
    ctx.commands.register("summarise", () =>
      ask(
        ctx.workspace.activeNotePath()
          ? "Summarise this note: a short paragraph, then at most five key points. Only facts from the note."
          : "Summarise the text of this drawing: a short paragraph, then at most five key points.",
      ),
    );
    ctx.commands.register("keep", () => {
      void session.keep();
    });
    ctx.commands.register("discard", () => session.discard());
    ctx.commands.register("cancel", () => session.cancel());
    ctx.commands.register("open", () => open());
    ctx.commands.register("new-chat", () => {
      session.newChat();
      open();
    });
    ctx.commands.register("next-tab", () => {
      ctx.panels.open("assistant");
      session.cycleTab(1);
    });
    ctx.commands.register("previous-tab", () => {
      ctx.panels.open("assistant");
      session.cycleTab(-1);
    });
    ctx.commands.register("close-tab", () => {
      session.closeTab(session.get().tab);
    });
    ctx.commands.register("history", () => {
      ctx.panels.open("assistant");
      session.setView("history");
    });
    ctx.commands.register("choose-model", () => {
      ctx.panels.open("assistant");
      session.openModelPicker();
    });
    ctx.commands.register("cycle-access", () => {
      void session.cycleAccess();
    });
    ctx.commands.register("cycle-effort", () => {
      void session.cycleEffort();
    });
    ctx.commands.register("settings", () => {
      ctx.panels.open("assistant");
      session.setView("settings");
    });
    ctx.commands.register("set-key", () => open("key"));
    ctx.commands.register("remove-key", async () => {
      await session.removeKey();
      ctx.ui.toast("API key removed");
    });
    ctx.commands.register("clear", () => session.clear());
    ctx.subscriptions.push({ dispose: () => session.cancel() });
  },
});
