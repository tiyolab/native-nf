const request = require('request');
const crypto = require('crypto');
const nforce = require('nforce');

/**
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
exports.verifyRequestSignature = (req, res, buf) => {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		// For testing, let's log an error. In production, you should throw an 
		// error.
		console.error("Couldn't validate the signature.");
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', GLOBAL_CONFIG.facebook_app.app_secret)
                        .update(buf)
                        .digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

/**
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
exports.receivedMessage = (org, event, req) => {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	console.log(JSON.stringify(message));

	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		// Just logging message echoes to console
		console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
		return;
	} else if (quickReply) {
		var quickReplyPayload = quickReply.payload;
		console.log("Quick reply for message %s with payload %s",
		messageId, quickReplyPayload);

		exports.sendTextMessage(senderID, "Quick reply tapped");
		return;
	}

	if (messageText) {
		var msgState = [];
		if(MY_SESSION[senderID] && MY_SESSION[senderID]['state'] != ''){
			msgState = MY_SESSION[senderID]['state'].split('/');
		}
	
		if(msgState.length > 0){
			if(msgState[0] == 'open_case'){
				if(msgState[1] == 'subject'){
					MY_SESSION[senderID]['data']['subject'] = messageText;
					MY_SESSION[senderID]['state'] = 'open_case/description';
				
					exports.sendTextMessage(senderID, 'Description');
				}else if(msgState[1] == 'description'){
					MY_SESSION[senderID]['data']['description'] = messageText;
				
					var nCase = nforce.createSObject('Case');
					nCase.set('OwnerId', '' + MY_SESSION[senderID].s_user_id);
					nCase.set('AccountId', '' + MY_SESSION[senderID].s_account_id);
					nCase.set('ContactId', '' + MY_SESSION[senderID].s_contact_id);
					nCase.set('Status', 'New');
					nCase.set('Origin', 'Web');
					nCase.set('Subject', MY_SESSION[senderID]['data']['subject']);
					nCase.set('Description', MY_SESSION[senderID]['data']['description']);
				
					org.insert({sobject: nCase}, function(err, res){
						if(!err){
							exports.sendTextMessage(senderID, 'Successfully open new case.');
						}else{
							console.log(err);
							exports.sendTextMessage(senderID, 'Failed open new case.');
						}
						MY_SESSION[senderID]['state'] = '';
					});
				}
			}
		}else{
			if(messageText.search(/broker/i) > -1){
				exports.sendAskForLocation(senderID);
			}else if(messageText.search(/hei/i) > -1 || messageText.search(/hi/i) > -1){
				exports.sendTextMessage(senderID, 'Hi');
			}else if(messageText.search(/help/i) > -1){
				exports.sendTextMessage(senderID, '1. "Show Broker" to show all our brokers in the area.'+
				'\n2. "Open Case" to open new case.'+
				'\n3. "Open Community" to open Community.'+
				'\n4. "Cancel Community" to leave from community.');
			}else if(messageText.search(/open case/i) > -1){
				if(MY_SESSION[senderID]){
					MY_SESSION[senderID]['state'] = 'open_case/subject';
					exports.sendTextMessage(senderID, 'Subject');
				}else{
					exports.authMessage(senderID);
				}
			}else if(messageText.search(/cancel community/i) > -1){
				if(MY_SESSION[senderID]){
					exports.sendTextMessage(senderID, "Please wait. we'll process your request.");
					exports.processCancelCommunity(MY_SESSION[senderID].s_user_id, senderID);
				}else{
					exports.sendTextMessage(senderID, "You're not our community member yet.");
				}
			}else if(messageText.search(/open community/i) > -1){
				exports.openCommunity(senderID);
			}else{
				//exports.sendTextMessage(senderID, messageText);
				botResponse(org, event);
			}
		}
	} else if (messageAttachments) {
		messageAttachments.forEach(function(attachment){
			if(attachment.type == 'location'){
				exports.sendShowBrokerMessageByLocation(
				org,
				{
					lat: attachment.payload.coordinates.lat,
					lng: attachment.payload.coordinates.long
				}, senderID);
			}
		});
	}
}


/**
 * Send plain text message using the Send API.
 */
exports.sendTextMessage = (recipientId, messageText) => {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: messageText,
			metadata: "DEVELOPER_DEFINED_METADATA"
		}
	};

	exports.callSendAPI(messageData);
}


/**
 * Authenticate message for user which chat session not save/registered yet
 */
exports.authMessage = (recipientId) => {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message:{
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: [
						{
							title: "We need to synchronize first, please click button below.",
							image_url: "https://raw.githubusercontent.com/tiyolab/bb-event/master/mortgage-central.jpg",
							buttons: [
								{
									type: "account_link",
									url: GLOBAL_CONFIG.host + "/ssoauth?senderid="+recipientId,
								}
							]
						}
					]
				}
			}
		}
	}

	exports.callSendAPI(messageData);
}


/**
 * Message to offer join community for fb user which not joined yet
 */
exports.joinMessage = (recipientId) => {
	var messageData = {
		recipient: {
		  id: recipientId
		},
		message:{
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: [
						{
							title: "it seem you are not our community member. feel free to join us by click button below.",
							image_url: "https://raw.githubusercontent.com/tiyolab/bb-event/master/mortgage-central.jpg",
							buttons: [
								{
									type: "web_url",
									url: 'https://apiai-community-developer-edition.ap4.force.com/mortgagetestv1',
									title:"Join"
								}
							]
						}
					]
				}
			}
		}
	}

	exports.callSendAPI(messageData);
}


/**
 * Message to open community page
 */
exports.openCommunity = (recipientId) => {
	var messageData = {
		recipient: {
		  id: recipientId
		},
		message:{
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: [
						{
							title: "Click button bellow to open community",
							image_url: "https://raw.githubusercontent.com/tiyolab/bb-event/master/mortgage-central.jpg",
							buttons: [
								{
									type: "web_url",
									url: 'https://apiai-community-developer-edition.ap4.force.com/mortgagetestv1',
									title:"Open"
								}
							]
						}
					]
				}
			}
		}
	}

	exports.callSendAPI(messageData);
}

/**
 * message to show broker list
 */
exports.sendShowBrokerMessage = (org, recipientId) => {
	org.query({query : "select Id, Name, BillingStreet, Website, String_Logo__c, Phone from Account limit 10"}, function(errQuery, respQuery){
		if(errQuery){
			console.log(errQuery);
		}else{
			var elementsAccount = [];
			respQuery.records.forEach(function(ac){
				var phone = '';
                if(ac.get('Phone')){
                    phone = ac.get('Phone');
                }
                
                
                var street = '';
                if(ac.get('BillingStreet')){
                	street = ac.get('BillingStreet');
                }
                elementsAccount.push(
					{
					  title: ac.get('Name'),
					  subtitle: "Address: "+ street.replace('\n', ' ').replace('\r',' ') +" Website: "+ ac.get('Website'),
					  image_url: "https://tiyolab-domain-dev-ed--c.ap4.content.force.com/servlet/servlet.ImageServer?id="+ ac.get('String_Logo__c') +"&oid=00D6F000001N2Q8",
					  buttons: [
						{
						  type: "phone_number",
						  title: "Call",
						  payload: phone
						},
						{
						  type: "postback",
						  title: "Refer Me",
						  payload: "test"
						}
					  ]
					}
				);
			})
			
			var messageData = {
				recipient: {
				  id: recipientId
				},
				message:{
				  attachment: {
					type: "template",
					payload: {
					  template_type: "generic",
					  elements: elementsAccount
					}
				  }
				}
			}
			exports.callSendAPI(messageData);
		}
	});
}


/**
 * message to ask user location
 */
exports.sendAskForLocation = (recipientId) => {
	var messageData = {
		recipient:{
			id:	recipientId
		},
		message:{
			text:"Please share your location to find broker in radius 20Km around your location.",
			quick_replies:[
				{
					content_type:"location",
				}
			]
		}	
	}

	exports.callSendAPI(messageData);
}

/**
 * show broker list by nearest location
 */
exports.sendShowBrokerMessageByLocation = (org, location, recipientId) => {
	org.query({query : "select Id, Name, BillingStreet, BillingCity, BillingCountry, String_Logo__c, Location__Latitude__s, Location__Longitude__s, Phone from Account"}, function(errQuery, respQuery){
		if(errQuery){
			console.log(errQuery);
		}else{
			var elementsAccount = [];
			respQuery.records.forEach(function(ac){
				var phone = '-';
                if(ac.get('Phone')){
                    phone = ac.get('Phone');
                }
                
                
                var street = '';
                if(ac.get('BillingStreet')){
                	street += ac.get('BillingStreet') + ', ';
                }
				
				if(ac.get('BillingCity')){
                	street += ac.get('BillingCity') + ', ';
                }
				
				if(ac.get('BillingCountry')){
                	street += ac.get('BillingCountry');
                }
				
				var distance = harvesine(location, {
					lat:ac.get('Location__Latitude__s'), 
					lng:ac.get('Location__Longitude__s')
				});
				
				if(distance <= 20){
					elementsAccount.push(
						{
						  title: ac.get('Name'),
						  subtitle: "Address: "+ street.replace('\n', ' ').replace('\r',' ') +" \nPhone: "+ phone,
						  image_url: "https://tiyolab-domain-dev-ed--c.ap4.content.force.com/servlet/servlet.ImageServer?id="+ ac.get('String_Logo__c') +"&oid=00D6F000001N2Q8",
						  buttons: [
							{
							  type: "phone_number",
							  title: "Call",
							  payload: phone
							},
							{
							  type: "postback",
							  title: "Refer Me",
							  payload: "test"
							}
						  ]
						}
					);
				}
			});
			
			var messageToSend = {};
			if(elementsAccount.length > 0){
				messageToSend = {
				  attachment: {
					type: "template",
					payload: {
					  template_type: "generic",
					  elements: elementsAccount
					}
				  }
				}
			}else{
				messageToSend = {
					text: "No broker available near 20Km arround you"
				}
			}
			
			var messageData = {
				recipient: {
				  id: recipientId
				},
				message: messageToSend
			}
			exports.callSendAPI(messageData);
		}
	});
}


/**
 * function to calculate distance 2 position
 */
harvesine = (point1, point2) => {
	var R = 3956; // metres
	var lat1 = point1.lat;
	var lat2 = point2.lat;
	var dtLat = (lat2-lat1);
	var dtLng = (point2.lng-point1.lng);

	var a = Math.sin(dtLat/2) * Math.sin(dtLat/2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(dtLng/2) * Math.sin(dtLng/2);
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

	var d = R * c;
	return d;
}

/**
 * Process cancel community
 */
exports.processCancelCommunity = (sUserId, senderId) => {
	request({
		method	: 'POST',
		url		: 'https://tiyolab-developer-edition.ap4.force.com/services/apexrest/mortgagetestv1',
		json	: {
			action: 'cancelcommunity',
			userid: sUserId
		}
	}, function(err, res, body){
		if (!err && res.statusCode == 200) {
			if(body.status){
				delete MY_SESSION[senderId];
				exports.sendTextMessage(senderId, "Success leaving community.");
			}else{
				exports.sendTextMessage(senderId, "Failed to leave community.");
			}
		}else{
			console.error("failed to exit community", res.statusCode, res.statusMessage, body.error);
			exports.sendTextMessage(senderId, "Failed to leave community.");
		}
	});
}

/**
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
exports.callSendAPI = (messageData) => {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: { access_token: GLOBAL_CONFIG.facebook_app.page_access_token },
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s", 
				messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s", 
				recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});  
}

exports.loadBotResponseConfiguration = (db) => {
		var collection = db.collection('response_configuration');
		collection.findOne({},function(err, data){
			if(data){
				BOT_CONFIGURATION = data.item;
			}
		});
}

function botResponse(org, event){
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;
	
	var messageText = message.text;
	var isFind = false;
	
	BOT_CONFIGURATION.some(function(item, index){
		isFind = false;
		
		item.requests.some(function(req, idx){
			if(messageText.search(new RegExp(req, "i")) > -1){
				isFind = true;
				return true;
			}
		});
		
		if(isFind){
			constructResponse(org, senderID, item.responses);
			return true;
		}
	});
}

function constructResponse(org, senderId, responses){
	responses.forEach(function(res, idx){
		/**
		 * text message type
		 */
		if(res.type === 'text'){
			var messageData = {
				recipient: {
					id: senderId
				},
				message: {
					text: res.payload
				}
			};
			exports.callSendAPI(messageData);
		}else if(res.type === 'button_template'){
			var messageData = {
				recipient: {
				  id: senderId
				},
				message:{
					attachment: {
						type: "template",
						payload: {
							template_type: "button",
							text: res.payload.text,
							buttons: res.payload.buttons
						}
					}
				}
			}
			
			exports.callSendAPI(messageData);
		}else if(res.type === 'generic_template'){
			var tmpElements = {};
			tmpElements['title'] = res.payload.title;
			tmpElements['subtitle'] = res.payload.subtitle;
			tmpElements['image_url'] = res.payload.image_url;
			if(res.payload.buttons.length > 0){
				tmpElements['buttons'] = res.payload.buttons;
			}
			
			var messageData = {
				recipient: {
				  id: senderId
				},
				message:{
					attachment: {
						type: "template",
						payload: {
							template_type: "generic",
							elements:[
								tmpElements
							]
						}
					}
				}
			}
			
			console.log(tmpElements);
			exports.callSendAPI(messageData);
		}else if(res.type === 'salesforce_query'){
			var field = res.payload.query.fields.join();
			var where = [];
			if(res.payload.query.where.length > 0){
				res.payload.query.where.forEach(function(w){
					where.push(w.source + w.operator +w.destination);
				});
			}
			var strWhere = where.join(' and ');
			var query = 'select ' + field + ' from ' + res.payload.query.sobject + strWhere + ' limit 10';
			
			console.log('query');
			console.log(query);
			
			//var replacingTitle = res.payload.match(/\{(.*?)\}/g);
			
			org.query({query:query}, function(err, r){
				if(!err){
					var elements = [];
					var buttons = [];
					r.records.forEach(function(rec){
						res.payload.query.fields.forEach(function(f){
							buttons = [];
							res.payload.buttons.forEach(function(b){
								if(b.type == 'web_url'){
									buttons.push({
										type: b.type,
										title: replaceRegex(b.title, rec),
										url: replaceRegex(b.url, rec)
										
									});
								}
							});
							
							elements.push(
								{
								  title: replaceRegex(res.payload.title, rec),
								  subtitle: replaceRegex(res.payload.subtitle, rec),
								  image_url: replaceRegex(res.payload.image_url, rec),
								  buttons: buttons
								}
							);
							
						});
					});
					
					
					var messageToSend = {};
					if(elements.length > 0){
						messageToSend = {
						  attachment: {
							type: "template",
							payload: {
							  template_type: "generic",
							  elements: elements
							}
						  }
						}
					}else{
						messageToSend = {
							text: "Failed process your request"
						}
					}
					
					var messageData = {
						recipient: {
						  id: senderId
						},
						message: messageToSend
					}
					console.log(messageData)
					exports.callSendAPI(messageData);
				}
			});
		}
	});
}

function replaceRegex(str, record){
	console.log('record');
	console.log(record);
	
	if(str != ''){
		var toReplace = str.match(/\{(.*?)\}/g);
		console.log('string = ' + str);
		console.log('to replace');
		console.log(toReplace);
		
		toReplace.forEach(function(t){
			console.log('text = ' + t);
			console.log('value = ');
			console.log(t.match(/\{(.*)\}/)[1]);
			console.log('get');
			console.log(record.get(t.match(/\{(.*)\}/)[1]));
			str.replace(t, record.get(t.match(/\{(.*)\}/)[1]));
		});
	}
	
	return str;
}
