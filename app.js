/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

var mySession = [];

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');

var oauth;
var nforce = require('nforce');
var fs = require('fs');
var app = express();
var cookieParser = require('cookie-parser');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);

app.set('port', process.env.PORT || 1107);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(bodyParser.urlencoded({ extended: true })); 
app.use(express.static('public'));

app.use(cookieParser());
app.use(session({
	/*store: new RedisStore({
		host: 'https://mortgage-testv1.herokuapp.com/',
		port: app.get('port'),
		db: 2
	}),*/
	secret: 'd5e79d3c37be21dbe96afca771582b94'
}));

/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

console.log('tiyo said server running');

// use the nforce package to create a connection to salesforce.com
var org = nforce.createConnection({
  clientId: '3MVG9YDQS5WtC11rPPnDcisY1IxDsekPGj0vXsxGSP4BGRKf28MxnXp2vFuwfYql8y0wB7TwnkLdwBk0W6N4q',
  clientSecret: '2874640950902301743',
  //redirectUri: 'http://localhost:' + app.get('port') + '/oauth/_callback',
  redirectUri: 'https://apiai-community-developer-edition.ap4.force.com/mortagegecentral',
  apiVersion: 'v27.0',  // optional, defaults to current salesforce API version 
  environment: 'production',  // optional, salesforce 'sandbox' or 'production', production default 
  mode: 'multi' // optional, 'single' or 'multi' user mode, multi default 
});

org.authEndpoint = 'https:/tiyolab-developer-edition.ap4.force.com/services/oauth2/authorize';
org.loginUri = 'https://tiyolab-developer-edition.ap4.force.com/services/oauth2/token';

console.log(org);

/*
 * Use your own validation token. Check that the token used in the Webhook 
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
	console.log("tiyo said state in get");
	console.log(req.query['hub.verify_token']);
	console.log(VALIDATION_TOKEN);
	
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});

app.post('/auth', function(req, res){
	var data = req.body;
	
	org.authenticate({ username: data.username, password: data.password }, function(err, resp){
		if(err) {
			console.log('Error: ' + err.message);
			sendTextMessage(data.sid, 'Login failed. ' + err.message);
		} else {
			console.log('login success')
			console.log('Access Token: ' + resp.access_token);
			
			//get sender id
			request('https://graph.facebook.com/v2.6/me?access_token='+PAGE_ACCESS_TOKEN+'&fields=recipient&account_linking_token='+data.alt, function (error, response, body) {
				if (!error && response.statusCode == 200) {
					body = JSON.parse(body);
					
					//get sender profile
					request('https://graph.facebook.com/v2.6/'+ body.recipient +'?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token='+PAGE_ACCESS_TOKEN, function(errP, respP, bodyP){
						
						if (!errP && respP.statusCode == 200) {
							bodyP = JSON.parse(bodyP);
							
							var senderData = {
								oauth: resp,
								psid: body.recipient,
								pgid: body.id,
								first_name: bodyP.first_name,
								last_name: bodyP.last_name,
								profile_pic: bodyP.profile_pic,
								locale: bodyP.locale,
								timezone: bodyP.timezone,
								gender: bodyP.gender
							}
							mySession[data.sid] = senderData;
							
							console.log(mySession[data.sid]);
							
							sendTextMessage(data.sid, 'Login success, you can perform your last action');
						}else{
							console.error("Failed calling Send API", respP.statusCode, respP.statusMessage, bodyP.error);
							sendTextMessage(data.sid, 'Login failed. ' + errP);
						}
					});
				}else{
					console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
					sendTextMessage(data.sid, 'Login failed. ' + error);
				}
			});
		}
	});
	res.sendStatus(200);
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL. 
 * 
 */
app.get('/authorize', function(req, res) {
  var alt = req.query.account_linking_token;
  var senderID = req.query.sid;
  
  res.render('authorize', {
    alt: alt,
	senderID: senderID
  });
});

/**
 * oauth to facebook 
 */

var FB_REDIRECT_URI = 'fboauth3';
var FB_APP_ID = '720602331440012';
var FB_APP_SECRET = 'd5e79d3c37be21dbe96afca771582b94';
 
app.get('/ssoauth', function(req, res){
	var senderID = req.query.senderid;
	var requestUri = 'https://www.facebook.com/v2.8/dialog/oauth?client_id='+ FB_APP_ID +'&display=popup&response_type=code%20token&redirect_uri='+SERVER_URL+'/'+FB_REDIRECT_URI+'?senderid='+senderID;
	res.redirect(requestUri);
});

/**
 * bridge ouath facebook response
 */
app.get('/'+FB_REDIRECT_URI, function(req, res){
	res.render('bridgeuri', {
		senderID: req.query.senderid
	});
});

/**
 * handling ouath facebook response from bridge
 */
 app.get('/fboauthhandler', function(req, res){
	//confirm identity
	var uri = 'https://graph.facebook.com/debug_token?input_token='+ req.query.access_token +'&access_token='+ FB_APP_ID + '|' + FB_APP_SECRET;
	request(uri, function(err, resp, body){
		if (!err && resp.statusCode == 200) {
			body = JSON.parse(body);
			var userId = body.data.user_id;
			
			// get user profile
			var uriProfile = 'https://graph.facebook.com/me?access_token='+req.query.access_token+'&fields=id,name,first_name,last_name,gender,locale';
			request(uriProfile, function(errP, respP, bodyP){
				if (!errP && respP.statusCode == 200) {
					bodyP = JSON.parse(bodyP);
					var name = bodyP.name;
					var firstName = bodyP.first_name;
					var lastName = bodyP.last_name;
					var gender = bodyP.gender;
					var locale = bodyP.locale;
					
					console.log(bodyP);
					
					//console.log(bodyP);
					//create new user
					request({
						method	: 'POST',
						url		: 'https://tiyolab-developer-edition.ap4.force.com/services/apexrest/mortgagetestv1',
						json	: {
							userid: userId,
							name: name,
							firstname: firstName,
							lastname: lastName,
							senderid: req.query.senderid
						}
					}, function(errNU, respNU, bodyNU){
						if (!errNU && respNU.statusCode == 200) {
							console.log(bodyNU);
							
							// authenticate
							org.authenticate({username:bodyNU.username, password:bodyNU.password}, function(errAuth, respAuth){
								if(errAuth){
									console.log('Error: ' + errAuth.message);
									sendTextMessage(req.query.senderid, 'Login failed.');
									res.sendStatus(200);
								}else{
									var userData = {
										oauth: respAuth,
										psid: req.query.senderid,
										firstName: firstName,
										lastName: lastName,
										locale: locale,
										gender: gender
									}
									mySession[req.query.senderid] = userData;
									
									res.redirect('https://apiai-community-developer-edition.ap4.force.com/mortagegecentral/MortgageTestV1Page?u='
									+bodyNU.username+'&p='+bodyNU.password);
								}
							});
						}else{
							console.error("Failed create new user", respNU.statusCode, respNU.statusMessage, bodyNU.error);
							sendTextMessage(req.query.senderid, 'Login failed.');
							res.sendStatus(200);
						}
					});
				}else{
					console.error("Failed get profile", respP.statusCode, respP.statusMessage, bodyP.error);
					sendTextMessage(req.query.senderid, 'Login failed.');
					res.sendStatus(200);
				}
			});
		}else{
			console.error("Failed login to fb", resp.statusCode, resp.statusMessage, body.error);
			sendTextMessage(req.query.senderid, 'Login failed.');
			res.sendStatus(200);
		}
	});
 });

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
	console.log("tiyo said state in post");
	var data = req.body;
	
	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function(pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function(messagingEvent) {
				if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		//
		// You must send back a 200, within 20 seconds, to let us know you've 
		// successfully received the callback. Otherwise, the request will time out.
		res.sendStatus(200);
	}
});


app.get('/testsso', function(req, res){
	console.log(res);
});

app.post('/testsso', function(req, res){
	console.log(res);
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}


/*
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
function receivedMessage(event) {
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

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {

    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
	if(messageText.search(/broker/i) > -1){
		if(mySession[senderID]){
			sendShowBrokerMessage(senderID);
		}else{
			loginMessage(senderID);
		}
	}else{
		sendTextMessage(senderID, messageText);
	}
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}


/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'response from native bot = ' + messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}


/*
 * Send a message with the account linking call-to-action in order need login
 *
 */
function loginMessage(recipientId) {
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
					title: "Login",
				  image_url: "https://raw.githubusercontent.com/tiyolab/bb-event/master/mortgage-central.jpg",
				  buttons: [
					{
						type: "account_link",
						//url: SERVER_URL + "/authorize?sid="+recipientId
						url: SERVER_URL + "/ssoauth?senderid="+recipientId
					}
				  ]
				}
			  ]
			}
		  }
		}
	}

  callSendAPI(messageData);
}

/*
 * show broker list
 */
function sendShowBrokerMessage(recipientId){
	org.query({query : "select Id, Name, BillingStreet, Website, Phone from Account limit 10", oauth : mySession[recipientId].oauth}, function(errQuery, respQuery){
		if(errQuery){
			console.log(errQuery);
		}else{
			console.log(respQuery.records);
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
			});
			//var strElement = '{"messages":[{"attachment":{"type":"template","payload":{"template_type":"generic","elements":['+ String.join(elements, ',') +']}}}]}';
			
			//var elements = JSON.parse('['+elementsAccount.join(',')+']');
			console.log(elementsAccount);
			
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
			callSendAPI(messageData);
		}
	});
}


/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
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

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

