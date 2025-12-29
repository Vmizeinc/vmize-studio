#!/bin/bash

# =================================================================
# VMIZE STUDIO - AUTOMATED NETLIFY DEPLOYMENT SCRIPT
# =================================================================
# This script prepares and deploys your frontend to Netlify
# =================================================================

echo "🚀 VMIZE STUDIO - Netlify Deployment Script"
echo "============================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# =================================================================
# STEP 1: CHECK PREREQUISITES
# =================================================================

echo "📋 Step 1: Checking prerequisites..."

# Check if Netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo -e "${YELLOW}⚠️  Netlify CLI not found. Installing...${NC}"
    npm install -g netlify-cli
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Netlify CLI installed successfully${NC}"
    else
        echo -e "${RED}❌ Failed to install Netlify CLI${NC}"
        echo "Please install manually: npm install -g netlify-cli"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Netlify CLI is installed${NC}"
fi

echo ""

# =================================================================
# STEP 2: CREATE DEPLOYMENT FOLDER
# =================================================================

echo "📁 Step 2: Creating deployment folder..."

DEPLOY_DIR="vmize-frontend-deploy"

# Remove old deployment folder if exists
if [ -d "$DEPLOY_DIR" ]; then
    echo "   Removing old deployment folder..."
    rm -rf "$DEPLOY_DIR"
fi

# Create fresh deployment folder
mkdir -p "$DEPLOY_DIR"
echo -e "${GREEN}✅ Deployment folder created${NC}"
echo ""

# =================================================================
# STEP 3: COPY FRONTEND FILES
# =================================================================

echo "📄 Step 3: Copying frontend files..."

# Define frontend files to copy
FILES_TO_COPY=(
    "index.html"
    "about.html"
    "terms.html"
    "privacy.html"
    "integration-secure.html"
    "admin-login.html"
    "admin-dashboard.html"
    "vmize-logo.png"
    "vmize-tryon-demo.png"
    "favicon.svg"
    "favicon-light.svg"
    "favicon-dark.svg"
)

# Copy each file if it exists
COPIED_COUNT=0
for file in "${FILES_TO_COPY[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$DEPLOY_DIR/"
        echo "   ✓ Copied: $file"
        COPIED_COUNT=$((COPIED_COUNT + 1))
    else
        echo -e "   ${YELLOW}⚠️  Missing: $file${NC}"
    fi
done

echo ""
echo -e "${GREEN}✅ Copied $COPIED_COUNT files${NC}"
echo ""

# =================================================================
# STEP 4: VERIFY MAIN PAGE (index.html)
# =================================================================

echo "🔍 Step 4: Verifying index.html exists in deploy folder..."

if [ -f "$DEPLOY_DIR/index.html" ]; then
    echo -e "${GREEN}✅ index.html present in deploy folder${NC}"
else
    echo -e "${RED}❌ index.html not found in deploy folder!${NC}"
    echo "Please make sure you have an index.html (or vmize-studio-final.html) in the current directory."
    exit 1
fi

echo ""

# =================================================================
# STEP 5: CREATE _REDIRECTS FILE
# =================================================================

echo "📝 Step 5: Creating _redirects file..."

cat > "$DEPLOY_DIR/_redirects" << 'EOF'
# Redirect all routes to index.html for client-side routing
/*    /index.html   200
EOF

echo -e "${GREEN}✅ _redirects file created${NC}"
echo ""

# =================================================================
# STEP 6: CREATE NETLIFY.TOML
# =================================================================

echo "⚙️  Step 6: Creating netlify.toml configuration..."

cat > "$DEPLOY_DIR/netlify.toml" << 'EOF'
[build]
  publish = "."

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
EOF

echo -e "${GREEN}✅ netlify.toml created${NC}"
echo ""

# =================================================================
# STEP 7: UPDATE API URLS (OPTIONAL - MANUAL STEP)
# =================================================================

echo "🔧 Step 7: API URL Update Reminder..."
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Before deploying, update API URLs in your HTML files!${NC}"
echo ""
echo "   Find and replace in these files:"
echo "   • integration-secure.html"
echo "   • admin-dashboard.html"
echo "   • dashboard.html (if you have it)"
echo ""
echo "   Change FROM:"
echo "   const VMIZE_API_URL = 'http://localhost:5000';"
echo ""
echo "   Change TO (recommended runtime-friendly):"
echo "   const VMIZE_API_URL = window.VMIZE_API_URL || 'https://api.vmizestudio.com';"
echo ""
read -p "   Have you updated the API URLs? (y/n): " api_updated

if [[ $api_updated != "y" && $api_updated != "Y" ]]; then
    echo -e "${YELLOW}⚠️  Remember to update API URLs before deploying to production!${NC}"
fi

echo ""

# =================================================================
# STEP 8: DEPLOYMENT OPTIONS
# =================================================================

echo "🚀 Step 8: Ready to Deploy!"
echo ""
echo "Choose deployment option:"
echo ""
echo "1) Deploy to Netlify (requires login)"
echo "2) Create zip file for manual upload"
echo "3) Exit (I'll deploy manually)"
echo ""
read -p "Enter your choice (1-3): " deploy_choice

case $deploy_choice in
    1)
        echo ""
        echo "🌐 Deploying to Netlify..."
        echo ""
        
        # Check if logged in to Netlify
        if netlify status &> /dev/null; then
            echo -e "${GREEN}✅ Already logged in to Netlify${NC}"
        else
            echo "Please log in to Netlify:"
            netlify login
        fi
        
        # Deploy to Netlify
        cd "$DEPLOY_DIR"
        netlify deploy
        
        echo ""
        echo -e "${GREEN}✅ Deployment initiated!${NC}"
        echo ""
        echo "To deploy to production (not draft), run:"
        echo "cd $DEPLOY_DIR && netlify deploy --prod"
        ;;
        
    2)
        echo ""
        echo "📦 Creating deployment zip file..."
        
        ZIP_NAME="vmize-frontend-$(date +%Y%m%d-%H%M%S).zip"
        
        cd "$DEPLOY_DIR"
        zip -r "../$ZIP_NAME" .
        cd ..
        
        echo ""
        echo -e "${GREEN}✅ Zip file created: $ZIP_NAME${NC}"
        echo ""
        echo "Upload this file to Netlify:"
        echo "1. Go to https://app.netlify.com"
        echo "2. Click 'Add new site' → 'Deploy manually'"
        echo "3. Drag and drop $ZIP_NAME"
        ;;
        
    3)
        echo ""
        echo "📂 Deployment folder ready at: $DEPLOY_DIR"
        echo ""
        echo "Manual deployment options:"
        echo ""
        echo "Option 1 - Drag & Drop:"
        echo "  1. Go to https://app.netlify.com"
        echo "  2. Drag the '$DEPLOY_DIR' folder onto the page"
        echo ""
        echo "Option 2 - Netlify CLI:"
        echo "  cd $DEPLOY_DIR"
        echo "  netlify deploy"
        echo "  netlify deploy --prod  (for production)"
        ;;
        
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo "═════════════════════════════════════════"
echo "🎉 Deployment preparation complete!"
echo "═════════════════════════════════════════"
echo ""

# =================================================================
# STEP 9: POST-DEPLOYMENT CHECKLIST
# =================================================================

echo "📋 Post-Deployment Checklist:"
echo ""
echo "  [ ] Test all pages load correctly"
echo "  [ ] Verify logo and images display"
echo "  [ ] Test navigation between pages"
echo "  [ ] Check that forms work (contact, etc.)"
echo "  [ ] Verify API calls work (if backend is deployed)"
echo "  [ ] Test on mobile devices"
echo "  [ ] Add custom domain (optional)"
echo "  [ ] Set up HTTPS/SSL (automatic on Netlify)"
echo ""

echo "🔗 Useful Netlify Commands:"
echo ""
echo "  netlify status          - Check login status"
echo "  netlify sites:list      - List your sites"
echo "  netlify open            - Open site in browser"
echo "  netlify deploy --prod   - Deploy to production"
echo ""

echo "📧 Questions? Contact: contactus@vmizestudio.com"
echo ""
echo "✨ Good luck with your launch!"
echo ""
