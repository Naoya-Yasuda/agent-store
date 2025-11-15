const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 4000;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());

// Agent Card endpoint
app.get('/agent-card.json', (req, res) => {
  res.json({
    "name": "フライト予約エージェント",
    "version": "2.0.0",
    "description": "GPT-4o-miniを使用したAI搭載フライト予約アシスタント。自然言語での会話でフライト検索と予約をサポートします。",
    "author": "テスト株式会社",
    "capabilities": [
      "flight_search",
      "booking_management",
      "price_comparison",
      "natural_language_understanding",
      "conversational_ai",
      "japanese_language_support"
    ],
    "endpoints": {
      "base_url": process.env.BASE_URL || "http://localhost:4000",
      "chat": "/agent/chat"
    },
    "security": {
      "authentication": "none",
      "rate_limit": "100 requests per minute"
    },
    "model": {
      "provider": "OpenAI",
      "model": "gpt-4o-mini",
      "temperature": 0.7
    },
    "language": "ja"
  });
});

// Mock flight data
const mockFlights = [
  {
    id: "FL001",
    airline: "Sky Airlines",
    from: "Tokyo",
    to: "Osaka",
    departure: "2025-12-01T10:00:00Z",
    arrival: "2025-12-01T11:30:00Z",
    price: 15000,
    currency: "JPY",
    available_seats: 42
  },
  {
    id: "FL002",
    airline: "Ocean Air",
    from: "Tokyo",
    to: "Osaka",
    departure: "2025-12-01T14:00:00Z",
    arrival: "2025-12-01T15:30:00Z",
    price: 12000,
    currency: "JPY",
    available_seats: 18
  },
  {
    id: "FL003",
    airline: "Sky Airlines",
    from: "Osaka",
    to: "Tokyo",
    departure: "2025-12-02T09:00:00Z",
    arrival: "2025-12-02T10:30:00Z",
    price: 14500,
    currency: "JPY",
    available_seats: 55
  }
];

// Agent chat endpoint with LLM
app.post('/agent/chat', async (req, res) => {
  const { message, context } = req.body;

  if (!message) {
    return res.status(400).json({
      error: "Message is required"
    });
  }

  try {
    // Build conversation history
    const messages = [
      {
        role: "system",
        content: `あなたは親切なフライト予約アシスタントです。以下のフライト情報にアクセスできます：

${JSON.stringify(mockFlights, null, 2)}

あなたの役割：
1. ユーザーの出発地と目的地に基づいてフライトを検索する
2. フライト情報（価格、時刻、空席状況）を提供する
3. フライトに関する質問に答える
4. 親切で丁寧な対応をする

回答時の注意点：
- フライトについて尋ねられたら、利用可能なフライトから適切なものを検索して提示する
- フライト情報は時刻、価格、空席数を明確にフォーマットして表示する
- 次のステップを提案したり、必要に応じて確認の質問をする
- **必ず日本語で回答してください**
- 丁寧な言葉遣いを使用してください（です・ます調）`
      }
    ];

    // Add conversation history from context if available
    if (context && context.history) {
      messages.push(...context.history);
    }

    // Add current user message
    messages.push({
      role: "user",
      content: message
    });

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      temperature: 0.7,
      max_tokens: 500
    });

    const assistantMessage = completion.choices[0].message.content;

    // Parse flight IDs from the response to include full flight data
    const mentionedFlights = mockFlights.filter(flight =>
      assistantMessage.includes(flight.id)
    );

    // Build response
    const response = {
      type: "llm_response",
      message: assistantMessage,
      flights: mentionedFlights.length > 0 ? mentionedFlights : undefined,
      model: "gpt-4o-mini",
      suggestions: []
    };

    // Update context with conversation history
    const newHistory = [
      ...(context?.history || []),
      { role: "user", content: message },
      { role: "assistant", content: assistantMessage }
    ].slice(-10); // Keep last 10 messages

    res.json({
      agent: "フライト予約エージェント",
      response: response,
      context: {
        ...context,
        history: newHistory
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({
      error: "Failed to process request",
      message: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: "healthy",
    agent: "フライト予約エージェント",
    version: "2.0.0",
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock Flight Agent running on port ${PORT}`);
  console.log(`Agent Card: http://localhost:${PORT}/agent-card.json`);
  console.log(`Chat Endpoint: http://localhost:${PORT}/agent/chat`);
});
