# W2 reply frames of the companion app

What the app's own serialiser (`Frames`, through `VerbDispatcher`) sends for a request,
checked by `WireFixturesTest`. Source of truth: AionCore `aionui-api-types/src/devices.rs`
(`RelayOutbound::Request`, `RelayInbound::Response`).

- `id` is a JSON number in the request and is echoed with the same JSON type.
  (0.1.0 and 0.1.1 answered with a string id: core could not read the reply.)
- A verb without a result omits `result`.
- `screenshot`: `format` is `png` at scale 1 and `jpeg` (q80) when scaled down; `data_base64`
  is standard Base64 with padding, no line breaks; the whole frame stays under 16 MiB.
- An error reply has `ok: false` and `error {code, message}`; codes are core's `relay_error`.

0.2.0 also sends `health {battery_percent?, charging?, locked, accessibility_on, android_version?,
model?}` in `pair` / `hello` and as the `health` event when a field changes; `ui_tree` answers
`{xml, nodes, truncated}`. `WireDumpTest` writes every frame of the serialiser to
`build/wire/frames.jsonl`.
