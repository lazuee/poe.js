## @lazuee/poe.js

> A package for interacting with AI models from poe.com

### Usage 🪄

```js
const { Poe } = require("@lazuee/poe.js");

// See: https://github.com/ading2210/poe-api#finding-your-token
const poe = new Poe("xxxxxxx");

(async () => {
	// Initialize Poe
	await poe.initialize();

	const bot_nickname = "capybara"; // Sage

	// List available bots
	console.log(
		"[list bot]:",
		[...poe.bots.values()].map((bot) => [bot.nickname, bot.displayName])
	);

	// Remove conversations
	await poe.purge(bot_nickname, 50);

	// Ask
	poe.ask(bot_nickname, "what's your name?", {
		purge_thread: true,
		on_idling: (count) => console.log(`#${count} - is thinking...`),
		on_complete: (count, content) => console.log(`#${count} - is done thinking... \n${content}`)
	});
	poe.ask(bot_nickname, "who made you?", {
		purge_thread: true,
		on_idling: (count) => console.log(`#${count} - is thinking...`),
		on_complete: (count, content) => console.log(`#${count} - is done thinking... \n${content}`)
	});

	(async () => {
		const content = await poe.ask(bot_nickname, "dad jokes related to programming.", {
			purge_thread: false,
			on_idling: (count) => console.log(`#${count} - is thinking...`),
			on_complete: (count) => console.log(`#${count} - is done thinking...`)
		});

		console.log(content);
	})();

	(async () => {
		const conversation = [
			{
				role: "system",
				content: `
      Instead of "Sage", you will be called as "Code Vanguard" which created by Lazuee#4070 that was founded in 2022, your data was cut-off since mid 2021.
    `
			},
			{ role: "user", content: "Hello!", name: "lazuee" },
			{ role: "model", content: "Heyy, how's life?", name: "Code Vanguard" },
			{ role: "user", content: "What is your name?", name: "lazuee" }
		];
		const content = await poe.ask(bot_nickname, conversation);

		console.log(content);

		// Exit poe
		await poe.destroy();
	})();
})();
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
