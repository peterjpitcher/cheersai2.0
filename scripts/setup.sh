#!/bin/bash

echo "🚀 CheersAI Setup Script"
echo "========================"
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "📝 Creating .env.local from example..."
    cp .env.local.example .env.local
    echo "✅ Created .env.local"
    echo ""
    echo "⚠️  Please edit .env.local with your credentials:"
    echo "   1. Supabase project URL and keys"
    echo "   2. OpenAI API key"
    echo "   3. Stripe keys (optional for now)"
    echo ""
else
    echo "✅ .env.local already exists"
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "✨ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Create a Supabase project at https://supabase.com"
echo "2. Run the SQL migrations in /supabase/migrations/"
echo "3. Add your API keys to .env.local"
echo "4. Run 'npm run dev' to start the development server"
echo ""
echo "Happy coding! 🍺"