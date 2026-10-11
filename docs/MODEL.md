# Model and external data configuration

## Optional AI model

| Item | Configuration |
| --- | --- |
| Checkpoint | `Qwen/Qwen3-8B`, exposed by Ollama as `qwen3:8b` |
| Runtime | Ollama `/api/generate`, JSON output mode |
| License | Apache License 2.0 for the Qwen3 model release. Confirm the exact model card and license distributed with the checkpoint you deploy. |
| Local setup | Install Ollama, run `ollama pull qwen3:8b`, keep Ollama reachable by FastAPI, and configure `OLLAMA_BASE_URL` / `OLLAMA_MODEL`. |
| Hardware | The quantized Ollama package is several GB. Plan on at least 8 GB available memory for quantized GPU inference, or 16 GB system RAM for CPU inference; actual latency/memory varies by quantization, runtime and context. |
| Production | Run the pinned model/runtime on a private inference host; do not expose Ollama publicly. Add resource limits, authentication, monitoring and a model artifact/license review before deployment. |

The app never includes a model credential. If Ollama is unavailable or returns malformed JSON, FastAPI emits a deterministic, visibly non-AI-generated itinerary. The model sees only a verified place name/address/category and the organizer's mood, budget and duration. It does not receive profile data, group-member names, private calendars, raw busy intervals, or arbitrary tool access.

The current adapter does not allow model-initiated calls: trusted FastAPI code searches/validates places first, then asks the model for a constrained draft. Model output is bounded and validated before saving; the organizer must explicitly publish. Opening hours, routes, costs, and forecast text are never taken from generated output.

## Place, weather and map data

- **OpenStreetMap Nominatim** provides city-based place search and provider-ID revalidation. Attribution is shown in-app and place display data carries `© OpenStreetMap contributors`. Review the Open Database License and Nominatim usage policy before launch; configure a real identifying contact in `PLACE_PROVIDER_USER_AGENT` and respect the public service rate limits. A hosted OSM-compatible provider is recommended for production traffic.
- **Open-Meteo** provides available daily forecast fields without an API key for this demo. Forecast coverage is limited; the app labels missing forecasts as unavailable. Review provider terms, attribution requirements and any commercial-use/API terms for the intended deployment.
- Coordinates, forecast and place data are suggestions, not confirmation that a venue is open, public, accessible, or safe. The itinerary avoids route/cost claims unsupported by a trusted provider.

No Google Calendar, Apple EventKit, Android Calendar Provider, routing, maps SDK, push notification, or photo-provider integration is active. The code must not be described as having those live integrations.
