import express from 'express';
import path from 'path';
import { thoughtproofX402 } from '../src/middleware';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Serve the demo page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Demo API endpoint protected by ThoughtProof x402
app.post('/api/buy', thoughtproofX402({
  apiKey: process.env.THOUGHTPROOF_API_KEY || 'demo-key',
  endpoint: 'https://api.thoughtproof.ai/v1/verify',
  policies: {
    reasoning_integrity: {
      min_confidence: 0.8,
      block_on_manipulation: true,
      require_attestation: true
    },
    budget_validation: {
      max_amount: 5000,
      require_budget_check: true
    }
  }
}), async (req, res) => {
  try {
    const { product, amount, reasoning } = req.body;
    
    // Extract ThoughtProof verification results from middleware
    const verification = req.thoughtproof;
    
    console.log('ThoughtProof Verification:', verification);
    
    // Simulate payment processing
    const paymentResult = {
      transaction_id: `txn_${Date.now()}`,
      product,
      amount,
      status: 'completed',
      timestamp: new Date().toISOString(),
      verification_id: verification.attestation_id,
      confidence_score: verification.confidence
    };
    
    res.json({
      success: true,
      message: 'Payment processed successfully with verified reasoning',
      payment: paymentResult,
      verification: {
        verified: true,
        confidence: verification.confidence,
        attestation_id: verification.attestation_id,
        headers: {
          'X-ThoughtProof-Verified': 'true',
          'X-ThoughtProof-Confidence': verification.confidence.toString(),
          'X-ThoughtProof-Attestation': verification.attestation_id,
          'X-ThoughtProof-Timestamp': new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment processing failed',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'ThoughtProof x402 Demo Server',
    timestamp: new Date().toISOString()
  });
});

// Error handler for ThoughtProof verification failures
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'THOUGHTPROOF_VERIFICATION_FAILED') {
    return res.status(402).json({
      success: false,
      message: 'Payment blocked due to reasoning verification failure',
      error: {
        type: 'VERIFICATION_FAILED',
        confidence: err.confidence,
        reasoning_integrity: err.reasoning_integrity,
        manipulation_detected: err.manipulation_detected,
        denial_reason: err.message
      },
      verification: {
        verified: false,
        confidence: err.confidence,
        manipulation_indicators: err.manipulation_indicators || []
      }
    });
  }
  
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

app.listen(PORT, () => {
  console.log(`🚀 ThoughtProof x402 Demo Server running on http://localhost:${PORT}`);
  console.log(`📱 Open http://localhost:${PORT} to view the demo`);
  console.log(`🔒 API endpoint: POST http://localhost:${PORT}/api/buy`);
  console.log('\n📋 Test the API with:');
  console.log(`curl -X POST http://localhost:${PORT}/api/buy \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "X-Agent-Reasoning: I need to buy this MacBook for work..." \\`);
  console.log(`  -d '{"product": "MacBook Pro 16\"", "amount": 2999, "reasoning": "User needs professional laptop for video editing work"}'`);
});

export default app;
