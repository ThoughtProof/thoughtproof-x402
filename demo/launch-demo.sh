#!/bin/bash

echo "🚀 ThoughtProof x402 Demo Launcher"
echo "=================================="
echo ""

# Check if we're on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "📱 Opening demo in browser..."
    open index.html
else
    echo "📱 Open this file in your browser:"
    echo "   $(pwd)/index.html"
fi

echo ""
echo "✨ Demo Features:"
echo "• Interactive step-by-step verification flow"
echo "• Sound reasoning vs. injected reasoning scenarios" 
echo "• Real-time security analysis simulation"
echo "• Professional UI suitable for enterprise demos"
echo ""
echo "🔧 To run the full server demo:"
echo "   npm install && npm run dev"
echo ""
echo "📖 View README.md for complete setup instructions"
