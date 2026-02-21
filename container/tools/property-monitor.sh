#!/bin/bash
# Property Monitor tool - RentCast API wrapper
# Calls RentCast API for property values, rent estimates, and comparables.
#
# Config: /home/node/.nanoclaw-property/config.json
# Env:    RENTCAST_API_KEY (from env-dir) or config file
#
# Usage: property-monitor.sh <command> [args...]

ENV_FILE="/workspace/env-dir/env"
HISTORY_FILE="/workspace/group/property-history.json"
BASE_URL="https://api.rentcast.io/v1"

# Config can be in group dir (writable, preferred) or service config dir (read-only mount)
if [ -f "/workspace/group/property-config.json" ]; then
  CONFIG_FILE="/workspace/group/property-config.json"
elif [ -f "/home/node/.nanoclaw-property/config.json" ]; then
  CONFIG_FILE="/home/node/.nanoclaw-property/config.json"
else
  CONFIG_FILE="/workspace/group/property-config.json"
fi

# Load API key from env-dir first, then config
get_api_key() {
  if [ -f "$ENV_FILE" ]; then
    local key
    key=$(grep '^RENTCAST_API_KEY=' "$ENV_FILE" | cut -d= -f2-)
    if [ -n "$key" ]; then
      echo "$key"
      return
    fi
  fi
  if [ -f "$CONFIG_FILE" ]; then
    node -e "const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); console.log(c.apiKey||'')"
  fi
}

API_KEY=$(get_api_key)

if [ -z "$API_KEY" ]; then
  echo "Error: No RentCast API key found. Set RENTCAST_API_KEY in .env or add apiKey to $CONFIG_FILE"
  exit 1
fi

# URL-encode an address string
urlencode() {
  node -e "console.log(encodeURIComponent(process.argv[1]))" "$1"
}

case "$1" in
  check)
    # Check a single address: property details, value estimate, rent estimate
    ADDRESS="$2"
    if [ -z "$ADDRESS" ]; then
      echo "Usage: property-monitor.sh check '<address>'"
      exit 1
    fi
    ENCODED=$(urlencode "$ADDRESS")

    echo "Checking property: $ADDRESS"
    echo ""

    echo "=== Property Records ==="
    curl -s -H "X-Api-Key: $API_KEY" \
      "$BASE_URL/properties?address=$ENCODED" 2>/dev/null

    echo ""
    echo "=== Value Estimate ==="
    curl -s -H "X-Api-Key: $API_KEY" \
      "$BASE_URL/avm/value?address=$ENCODED" 2>/dev/null

    echo ""
    echo "=== Rent Estimate ==="
    curl -s -H "X-Api-Key: $API_KEY" \
      "$BASE_URL/avm/rent/long-term?address=$ENCODED" 2>/dev/null
    echo ""
    ;;

  check-all)
    # Check all configured addresses
    if [ ! -f "$CONFIG_FILE" ]; then
      echo "Error: Config file not found at $CONFIG_FILE"
      echo "Run /add-property-monitor to set up."
      exit 1
    fi

    node -e "
const fs = require('fs');
const https = require('https');
const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
const apiKey = '$API_KEY';
const baseUrl = '$BASE_URL';
const historyFile = '$HISTORY_FILE';

function fetchApi(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { 'X-Api-Key': apiKey }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Failed to parse response', raw: data }); }
      });
    }).on('error', reject);
  });
}

function formatMoney(n) {
  if (!n && n !== 0) return 'N/A';
  return '\$' + Math.round(n).toLocaleString('en-US');
}

function formatRange(low, high) {
  if (!low && !high) return 'N/A';
  return formatMoney(low) + '-' + formatMoney(high);
}

function pctChange(current, previous) {
  if (!previous || !current) return null;
  const diff = current - previous;
  const pct = ((diff / previous) * 100).toFixed(1);
  const sign = diff >= 0 ? '+' : '';
  return sign + formatMoney(diff) + ' (' + sign + pct + '%)';
}

async function main() {
  // Load history
  let history = {};
  try {
    if (fs.existsSync(historyFile)) {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    }
  } catch {}

  const addresses = config.addresses || [];
  if (addresses.length === 0) {
    console.log('No addresses configured. Add them to ' + '$CONFIG_FILE');
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  console.log('Property Monitor - Weekly Report');
  console.log(dateStr);
  console.log('');

  const newHistory = { lastRun: now.toISOString(), addresses: {} };

  for (const address of addresses) {
    const encoded = encodeURIComponent(address);

    let propData, valueData, rentData;
    try {
      [propData, valueData, rentData] = await Promise.all([
        fetchApi('/properties?address=' + encoded),
        fetchApi('/avm/value?address=' + encoded),
        fetchApi('/avm/rent/long-term?address=' + encoded),
      ]);
    } catch (err) {
      console.log('--- ' + address + ' ---');
      console.log('Error fetching data: ' + err.message);
      console.log('');
      continue;
    }

    // Extract property info
    const prop = Array.isArray(propData) ? propData[0] : propData;

    // Extract value estimate
    const value = valueData?.price || valueData?.value || null;
    const valueLow = valueData?.priceLow || valueData?.valueLow || null;
    const valueHigh = valueData?.priceHigh || valueData?.valueHigh || null;

    // Extract rent estimate
    const rent = rentData?.rent || rentData?.price || null;
    const rentLow = rentData?.rentRangeLow || rentData?.priceLow || null;
    const rentHigh = rentData?.rentRangeHigh || rentData?.priceHigh || null;

    // Tax and sale info
    const taxAssessment = prop?.taxAssessment || null;
    const taxYear = prop?.assessmentYear || null;
    const lastSalePrice = prop?.lastSalePrice || null;
    const lastSaleDate = prop?.lastSaleDate || null;

    // Comparables
    const valueComps = valueData?.comparables || [];
    const rentComps = rentData?.comparables || [];

    // Previous values for comparison
    const prev = history?.addresses?.[address] || {};

    console.log('--- ' + address + ' ---');
    console.log('Est. Value: ' + formatMoney(value) + (valueLow ? ' (range: ' + formatRange(valueLow, valueHigh) + ')' : ''));
    if (prev.value) {
      const change = pctChange(value, prev.value);
      console.log('  Change: ' + (change || 'No change'));
    }

    console.log('Est. Rent: ' + formatMoney(rent) + '/mo' + (rentLow ? ' (range: ' + formatRange(rentLow, rentHigh) + '/mo)' : ''));
    if (prev.rent) {
      const change = pctChange(rent, prev.rent);
      console.log('  Change: ' + (change || 'No change'));
    }

    if (taxAssessment) {
      console.log('Tax Assessment: ' + formatMoney(taxAssessment) + (taxYear ? ' (' + taxYear + ')' : ''));
    }
    if (lastSalePrice) {
      console.log('Last Sale: ' + formatMoney(lastSalePrice) + (lastSaleDate ? ' (' + lastSaleDate + ')' : ''));
    }

    // Show top comparables
    const comps = valueComps.slice(0, 3);
    if (comps.length > 0) {
      console.log('');
      console.log('Top Comparables:');
      for (const comp of comps) {
        const dist = comp.distance ? comp.distance.toFixed(1) + 'mi' : '?mi';
        const score = comp.score ? Math.round(comp.score * 100) + '% match' : '';
        const price = formatMoney(comp.price || comp.lastSalePrice);
        const addr = comp.formattedAddress || comp.address || 'Unknown';
        console.log('  - ' + addr + ' - ' + price + ' (' + [dist, score].filter(Boolean).join(', ') + ')');
      }
    }

    console.log('');

    // Save to history
    newHistory.addresses[address] = {
      value, valueLow, valueHigh,
      rent, rentLow, rentHigh,
      taxAssessment, taxYear,
      lastSalePrice, lastSaleDate,
      checkedAt: now.toISOString(),
    };

    // Check for significant changes
    if (prev.value && value) {
      const changePct = Math.abs((value - prev.value) / prev.value * 100);
      if (changePct > 5) {
        console.log('ACTION_NEEDED: Value changed ' + changePct.toFixed(1) + '% for ' + address);
        console.log('');
      }
    }
  }

  // Save updated history
  fs.writeFileSync(historyFile, JSON.stringify(newHistory, null, 2));
  console.log('History saved to ' + historyFile);
}

main().catch(err => {
  console.error('Fatal error: ' + err.message);
  process.exit(1);
});
"
    ;;

  history)
    # Show previous results
    if [ ! -f "$HISTORY_FILE" ]; then
      echo "No history found. Run 'check-all' first."
      exit 0
    fi
    node -e "
const fs = require('fs');
const h = JSON.parse(fs.readFileSync('$HISTORY_FILE', 'utf8'));
console.log('Last run:', h.lastRun || 'unknown');
console.log('');
for (const [addr, data] of Object.entries(h.addresses || {})) {
  console.log('--- ' + addr + ' ---');
  console.log('  Value: \$' + (data.value || 'N/A'));
  console.log('  Rent: \$' + (data.rent || 'N/A') + '/mo');
  console.log('  Checked: ' + (data.checkedAt || 'N/A'));
  console.log('');
}
"
    ;;

  config)
    # Show current configuration
    if [ ! -f "$CONFIG_FILE" ]; then
      echo "No config found at $CONFIG_FILE"
      echo "Run /add-property-monitor to set up."
      exit 0
    fi
    echo "Config: $CONFIG_FILE"
    echo "API Key: ${API_KEY:0:8}..."
    echo "Addresses:"
    node -e "
const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf8'));
(c.addresses || []).forEach((a, i) => console.log('  ' + (i+1) + '. ' + a));
"
    ;;

  *)
    echo "Property Monitor - RentCast API Tool"
    echo ""
    echo "Usage: property-monitor.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  check '<address>'   - Check a single property (3 API calls)"
    echo "  check-all           - Check all configured properties"
    echo "  history             - Show previous results"
    echo "  config              - Show current configuration"
    echo ""
    echo "Config: $CONFIG_FILE"
    echo "History: $HISTORY_FILE"
    echo ""
    echo "API budget: 2 addresses x 3 endpoints = 6 calls/run"
    echo "Free tier: 50 calls/month"
    ;;
esac
