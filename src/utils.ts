export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function uuidv4() {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

export function extractFormKey(html: string) {
	const scriptRegex = /<script>if\(.+\)throw new Error;(.+)<\/script>/;
	const scriptText = html.match(scriptRegex)![1];
	const keyRegex = /var .="([0-9a-f]+)",/;
	const keyText = scriptText.match(keyRegex)![1];
	const cipherRegex = /.\[(\d+)\]=.\[(\d+)\]/g;
	const cipherPairs = Array.from(scriptText.matchAll(cipherRegex));

	const formKeyList = new Array(cipherPairs.length).fill("");
	for (const pair of cipherPairs) {
		const [formKeyIndex, keyIndex] = pair.slice(1).map(Number);
		formKeyList[formKeyIndex] = keyText[keyIndex];
	}
	const formKey = formKeyList.join("");

	return formKey;
}

export function generateNonce(length: number) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let result = "";

	for (let i = 0; i < length; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		result += characters[randomIndex];
	}

	return result;
}
