# AI assistant

Ask a model you choose about your drawing, with your own key. Off until you turn it on in Settings, Plugins.

| Command | What it does |
| --- | --- |
| AI: Ask about this drawing | Opens the panel with the question box |
| AI: Describe the selection | Describes the selected shapes (or the drawing) |
| AI: Generate a diagram from text | Writes Mermaid, then draws it as shapes in one undo step |
| AI: Edit this drawing | Asks the model for changes (add, move, restyle, delete shapes, add text) and shows them first |
| AI: Create a new drawing | Asks the model for a whole new drawing and shows it first |
| AI: Keep the proposed change, Discard the proposed change | Applies it (one undo step; a new drawing is saved) or drops it |
| AI: Summarise this note | Summarises the note in the active tab, or the selected text, or all text in the drawing |
| AI: Stop the answer | Cancels the running request |
| AI: Set API key, Remove API key | Saves or removes the key |

Providers: Anthropic, OpenAI (or any OpenAI-style address), Ollama. Choose provider, model, address and timeout in Settings, Plugins, AI assistant.

- Edits are proposals: a plain list and a small preview, nothing changes or is saved until Keep, and Cmd+Z undoes the whole change. That is why the plugin asks to write drawings.
- Summarise reads the note from the file on disk (read only; the plugin never changes a note). That is why the plugin asks to read your vault.
- The panel can show exactly what is sent ("Show what is sent").
- The key is kept in your system keychain (the macOS Keychain, or the Secret Service on Linux), outside `config.toml` and your vault, and nothing can read it back. `[secrets] store = "file"` keeps it in a protected file instead (not encrypted).
- Offline mode stops every request except one to this computer (a local Ollama).
- Ollama on another computer: set the provider to Ollama, the address to `http://192.168.1.20:11434`, and list the computer in `config.toml`: `[network] allow_private_hosts = ["192.168.1.20:11434"]`. Nothing else on your network is reachable.
- No Vaultdraw server is involved: requests go straight from the app to the provider.
