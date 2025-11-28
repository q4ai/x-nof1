
async function checkPrecision() {
  try {
    const response = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo");
    const data = await response.json();
    const symbol = data.symbols.find(s => s.symbol === "CAKEUSDT");
    
    if (symbol) {
      console.log("Symbol: CAKEUSDT");
      console.log("Quantity Precision:", symbol.quantityPrecision);
      
      const lotSize = symbol.filters.find(f => f.filterType === "LOT_SIZE");
      console.log("LOT_SIZE:", lotSize);
      
      const marketLotSize = symbol.filters.find(f => f.filterType === "MARKET_LOT_SIZE");
      console.log("MARKET_LOT_SIZE:", marketLotSize);
    } else {
      console.log("CAKEUSDT not found");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

checkPrecision();
