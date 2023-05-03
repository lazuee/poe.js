## @lazuee/poe.js

> A package for interacting with AI models from poe.com

### Usage 🪄

```js
const { Poe } = require("@lazuee/poe.js");

const poe = new Poe({
	// See: https://github.com/ading2210/poe-api#finding-your-token
	token: "xxxxxx",

	// Purge conversation when there's no pending request on ask
	purge_conversation: {
		enable: true, // default: false
		count: 100 // default: 50
	}
});

(async () => {
	// Initialize Poe
	await poe.initialize();

	const bot_nickname = "capybara"; // Sage

	// List available bots
	console.log(`List of Chatbot:\n${[...poe.bots.values()].map((bot) => `- [${bot.nickname}] ${bot.displayName}`).join("\n")}\n`);

	// Ask
	poe.ask(bot_nickname, "What's your name?", {
		on_idling: (count) => console.log(`#${count} - task running...`),
		on_complete: (count, content) => console.log(`#${count} - task completed. \n#1 result: ${content}\n`)
	});

	(async () => {
		const content = await poe.ask(bot_nickname, "Dad joke related to programming.", {
			on_idling: (count) => console.log(`#${count} - task running...`),
			on_complete: (count) => console.log(`#${count} - task completed.`)
		});

		console.log(`#2 result: ${content}\n`);
	})();

	(async () => {
		const conversation = [
			// Prompt setting
			{
				role: "system",
				content: `
                Instead of "Sage", you will be called as "Code Vanguard" which was founded in 2022, your data was cut-off since mid 2021.`
			},
			// Conversation history
			{ role: "user", content: "Hello!", name: "lazuee" },
			{ role: "model", content: "Hi Lazuee! How may I help you today?", name: "Code Vanguard" },
			// Trigger model to reponse (Latest user message)
			{ role: "user", content: "What is your name?", name: "lazuee" }
		];
		const content = await poe.ask(bot_nickname, conversation);

		console.log(`#3 result: ${content}\n`);

		// Exit poe
		await poe.destroy();
	})();
})();

/*
Output:
List of Chatbot:
- [capybara] Sage
- [beaver] GPT-4
- [a2_2] Claude+
- [a2] Claude-instant
- [chinchilla] ChatGPT
- [hutia] NeevaAI
- [nutria] Dragonfly

#1 - task running...
#1 - task completed.
#1 result: My name is Sage.

#2 - task running...
#2 - task completed.
#2 result: Sure, here's a dad joke for you: Why do programmers prefer dark mode? Because light attracts bugs!

#3 result: My name is Code Vanguard. How can I assist you today?
*/
```

### Contributing to the project 💻

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

### Star the project 🌟

If you like the project, please leave a star on the [GitHub repository](https://github.com/lazuee/poe.js).

### License 🔑

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

Copyright © `2023` `lazuee`
