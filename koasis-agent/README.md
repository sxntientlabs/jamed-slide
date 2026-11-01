# Koasis Agent runtime

This image is the Koasis-specific fork layer around the upstream Hermes Agent
runtime. The upstream source is fetched at the pinned `HERMES_REF` during the
image build; Koasis behavior is supplied through the profile persona, skills,
model routing, and the request instructions added by the Koasis API.

The service listens on port `8642` only inside the private Docker network. It
must not be published directly to the public internet. The Koasis App calls it
with:

```text
http://koasis-agent:8642
```

Required runtime secrets:

- `KOASIS_AGENT_API_KEY`: caller key accepted by the Hermes API server.
- `KOASIS_PROVIDER_API_KEY`: key for the configured OpenAI-compatible model.
- `KOASIS_PROVIDER_BASE_URL`: provider base URL, including `/v1`.

The data volume stores the Hermes session database, persona, skills, logs, and
provider profile. Do not bake credentials into the image.
