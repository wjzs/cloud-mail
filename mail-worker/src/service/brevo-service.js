/**
 * Brevo 事务邮件发送通道（本站自定义扩展，上游无此文件）。
 *
 * 单独成文件的原因：email-service.js 是上游改动最频繁的文件，
 * 把 Brevo 的具体实现放在这里，合并上游更新时几乎不会产生冲突。
 *
 * 文档：https://developers.brevo.com/reference/sendtransacemail
 */
const brevoService = {

	/**
	 * 发送一封事务邮件。
	 * @param brevoToken  形如 xkeysib-xxxx 的 API key
	 * @param params      与其它渠道一致的 sendParams（accountEmail / receiveEmail / ccEmail ...）
	 * @param helpers     { toAttachmentBase64 } 由 email-service 注入，复用其附件转换逻辑
	 * @returns {Promise<{data?: {id: string}, error?: {message: string}}>}
	 */
	async send(brevoToken, params, helpers = {}) {
		const sendForm = {
			sender: {
				email: params.accountEmail,
				name: params.name || params.accountEmail
			},
			to: params.receiveEmail.map(address => ({ email: address })),
			subject: params.subject || ''
		};

		const ccEmail = params.ccEmail || [];
		const bccEmail = params.bccEmail || [];

		if (ccEmail.length > 0) {
			sendForm.cc = ccEmail.map(address => ({ email: address }));
		}

		if (bccEmail.length > 0) {
			sendForm.bcc = bccEmail.map(address => ({ email: address }));
		}

		if (params.html) {
			sendForm.htmlContent = this.toHtml(params.html, params.attachments);
		}

		if (params.text) {
			sendForm.textContent = params.text;
		}

		// Brevo 要求正文至少有一项
		if (!sendForm.htmlContent && !sendForm.textContent) {
			sendForm.textContent = ' ';
		}

		const attachments = await this.toAttachments(params.attachments, helpers.toAttachmentBase64);
		if (attachments.length > 0) {
			sendForm.attachment = attachments;
		}

		if (params.sendType === 'reply' && params.messageId) {
			sendForm.headers = {
				'in-reply-to': params.messageId,
				'references': params.messageId
			};
		}

		const response = await fetch('https://api.brevo.com/v3/smtp/email', {
			method: 'POST',
			headers: {
				'api-key': brevoToken,
				'content-type': 'application/json',
				accept: 'application/json'
			},
			body: JSON.stringify(sendForm)
		});

		const body = await response.json().catch(() => ({}));

		if (!response.ok) {
			// 401/403 多为 key 无效或域名未验证（Brevo 要求 sender 域名完成 DKIM 验证）
			return {
				error: {
					message: body.message
						? `Brevo: ${body.message}`
						: `Brevo 发送失败 (HTTP ${response.status})`
				}
			};
		}

		return { data: { id: body.messageId } };
	},

	// Brevo 的 JSON 接口不支持 cid 内嵌图，正文里的 cid:xxx 改用 data URI 内联
	toHtml(html, attachments = []) {
		if (!html) {
			return html;
		}

		let result = html;

		for (const attachment of attachments) {
			if (!attachment.contentId || !attachment.content || typeof attachment.content !== 'string') {
				continue;
			}

			let content = attachment.content;
			if (!content.startsWith('data:')) {
				const mimeType = attachment.mimeType || attachment.contentType || 'image/png';
				content = `data:${mimeType};base64,${content}`;
			}

			result = result.split(`cid:${attachment.contentId}`).join(content);
		}

		return result;
	},

	// Brevo 附件格式：{ content: base64, name: 文件名 }
	async toAttachments(attachments = [], toAttachmentBase64) {
		const result = [];

		for (const attachment of attachments) {
			// 内嵌图（contentId）已在 toHtml 里转成 data URI，不再作为附件重复发送
			if (attachment.contentId) {
				continue;
			}

			const content = await toAttachmentBase64(attachment);
			if (!content) {
				continue;
			}

			result.push({
				content,
				name: attachment.filename || attachment.name || 'attachment'
			});
		}

		return result;
	}
};

export default brevoService;
