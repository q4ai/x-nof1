import { createHash, createHmac } from "node:crypto";

// 從官方文檔複製的範例
const testCases = [
	{
		method: "GET",
		path: "/api/v4/futures/orders",
		queryString: "contract=BTC_USD&status=finished&limit=50",
		bodyString: "",
		timestamp: "1541993715",
		key: "key",
		secret: "secret",
		expectedSign:
			"55f84ea195d6fe57ce62464daaa7c3c02fa9d1dde954e4c898289c9a2407a3d6fb3faf24deff16790d726b66ac9f74526668b13bd01029199cc4fcc522418b8a",
	},
	{
		method: "POST",
		path: "/api/v4/futures/orders",
		queryString: "",
		bodyString:
			'{"contract":"BTC_USD","type":"limit","size":100,"price":6800,"time_in_force":"gtc"}',
		timestamp: "1541993715",
		key: "key",
		secret: "secret",
		expectedSign:
			"eae42da914a590ddf727473aff25fc87d50b64783941061f47a3fdb92742541fc4c2c14017581b4199a1418d54471c269c03a38d788d802e2c306c37636389f0",
	},
];

function generateSignature(
	method: string,
	path: string,
	queryString: string,
	bodyString: string,
	timestamp: string,
	secret: string,
): string {
	// 1. 計算 body 的 SHA512 hash
	const hashedBody = createHash("sha512")
		.update(bodyString)
		.digest("hex");

	// 2. 構建簽名字符串
	const signatureString = `${method}\n${path}\n${queryString}\n${hashedBody}\n${timestamp}`;

	// 3. 使用 HMAC-SHA512 簽名
	return createHmac("sha512", secret).update(signatureString).digest("hex");
}

console.log("=== Gate.io 簽名驗證測試 ===\n");

for (const testCase of testCases) {
	const { method, path, queryString, bodyString, timestamp, secret, expectedSign } = testCase;

	const actualSign = generateSignature(method, path, queryString, bodyString, timestamp, secret);

	console.log(`測試: ${method} ${path}`);
	console.log(`預期簽名: ${expectedSign}`);
	console.log(`實際簽名: ${actualSign}`);
	console.log(`結果: ${actualSign === expectedSign ? "✅ 通過" : "❌ 失敗"}\n`);
}

// 測試空 body 的 hash
const emptyBodyHash = createHash("sha512").update("").digest("hex");
console.log("空 body 的 SHA512 hash:");
console.log(emptyBodyHash);
console.log(
	"預期值: cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
);
console.log(
	`結果: ${
		emptyBodyHash ===
		"cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
			? "✅ 正確"
			: "❌ 錯誤"
	}`,
);
