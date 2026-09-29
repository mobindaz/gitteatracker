#!/bin/bash

# Gitea Time Tracker - Production Deployment Script
# This script builds and deploys the Vue app to production

set -e  # Exit on any error

echo "🚀 Starting deployment..."

# Navigate to project directory
cd "$(dirname "$0")"

# Build the Vue app
echo "📦 Building Vue app..."
npm run build

# Reload Nginx to ensure latest files are served
echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx

echo "✅ Deployment complete!"
echo "🌐 Your app is now live and accessible via your domain"
echo ""
echo "📊 Status:"
sudo systemctl status nginx --no-pager | head -5
