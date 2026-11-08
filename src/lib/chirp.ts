// Server only. Real dependencies for chirp-relay: Chirp 3 client, Supabase token check, transcript parsing.
// Credentials: GOOGLE_SERVICE_ACCOUNT_JSON (one-line JSON of a service-account key) or Application Default Credentials.
// Chirp rejects API keys (tested: HTTP 401 "API keys are not supported by this API").
import { v2 } from '@google-cloud/speech'
import { createClient } from '@supabase/supabase-js'
import { extractWithAI } from './extract'
import { needsAI, parseCapture } from './parse'
import { limited } from './ratelimit'
import type { RelayDeps, SpeechStream } from './chirp-relay'

export function chirpEnv(env = process.env) {
  const sa = env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { project_id?: string; client_email?: string; private_key?: string } : null
  const project = env.CHIRP_PROJECT_ID ?? sa?.project_id ?? ''
  const region = env.CHIRP_REGION ?? 'us'  // chirp_3 regions per docs: us, eu (multi-region)
  return { sa, project, region, ok: !!project && (!!sa || !!env.GOOGLE_APPLICATION_CREDENTIALS) }
}

let client: InstanceType<typeof v2.SpeechClient> | null = null
function speech() {
  const { sa, region } = chirpEnv()
  client ??= new v2.SpeechClient({ apiEndpoint: `${region}-speech.googleapis.com`, ...(sa ? { credentials: { client_email: sa.client_email, private_key: sa.private_key } } : {}) })
  return client
}

export function chirpDeps(): RelayDeps {
  const { project, region } = chirpEnv()
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  return {
    verify: async token => (await supabase.auth.getClaims(token)).data?.claims?.sub ?? null,
    open: () => speech()._streamingRecognize() as unknown as SpeechStream,
    config: {
      recognizer: `projects/${project}/locations/${region}/recognizers/_`,
      streamingConfig: {
        config: {
          explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: 16000, audioChannelCount: 1 },
          languageCodes: ['km-KH'],  // Preview for chirp_3
          model: 'chirp_3',
        },
        streamingFeatures: { interimResults: true },
      },
    },
    // same pipeline as typed text and the Gemini path
    parse: async (text, mode) => {
      const local = parseCapture(text, mode)
      const ai = needsAI(text, local) ? await extractWithAI(text, mode, 'voice') : null
      return { candidates: ai ?? local, usedAI: !!ai }
    },
    limited: user => limited(`chirp:${user}`, 12),
  }
}
