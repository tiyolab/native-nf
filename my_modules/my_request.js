const os = require('os');
const _package = require('../package.json');
const myFunctional = require('./my_functional');
const nforce = require('nforce');
const request = require('request');
var org = {};

exports.handleConfigure = (app, db) => {
	console.log();
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		collection.findOne({
			my_app_name: _package.name
		}, function(err, item){
			if(item){
				item['status'] = -1;
				res.render('configure_change', item);
			}else{
				res.render('configure');
			}
		});
	});
	
	app.post('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		var data = req.body;
		
		data['host'] = 'https://' + req.headers.host + '/';
		data['my_app_name'] = _package.name;
		
		if(data.status_record === 'new'){
			collection.insert(data, {w:1}, function(err, result){
				if(err){
					data['status']= 0;
				}else{
					data['status']= 1;
				}
				res.render('configure_change', data);
			});
		}else if(data.status_record === 'old'){
			collection.update({my_app_name: _package.name}, {$set: data}, {w:1}, function(err, result){
				if(err){
					data['status']= 0;
				}else {
					data['status']= 1;
				}
				res.render('configure_change', data);
			});
		}
		
		GLOBAL_CONFIG = data;
		exports.handleRequest(app, db);
		//xxx
	});
}

exports.handleRequest = (app, db) => {
	/**
	 * create salesforce connection
	 */
	org = nforce.createConnection({
		clientId: GLOBAL_CONFIG.salesforce_app.consumer_key,
		clientSecret: GLOBAL_CONFIG.salesforce_app.consumer_secret,
		redirectUri: 'http://localhost:' + app.get('port') + '/oauth/_callback',
		apiVersion: 'v27.0',  // optional, defaults to current salesforce API version 
		environment: 'production',  // optional, salesforce 'sandbox' or 'production', production default 
		mode: 'single', // optional, 'single' or 'multi' user mode, multi default'
		username: GLOBAL_CONFIG.salesforce_app.username,
		password: GLOBAL_CONFIG.salesforce_app.password
	});
	
	/**
	 * create salesforce authentication
	 */
	org.authenticate({ username: org.username, password: org.password}, function(err, resp){
		// the oauth object was stored in the connection object
		if(err){
			console.error('Error connect to salesforce: ');
			console.error(err);
		}else{
			console.log('salesforce auth success');
		}
	});
	
	
	/**
	 * create facebook oauth
	 */
	var FB_REDIRECT_URI = 'fboauth3';
	app.get('/ssoauth', function(req, res){
		var senderID = req.query.senderid;
		var requestUri = 'https://www.facebook.com/v2.8/dialog/oauth?client_id='+ GLOBAL_CONFIG.facebook_app.app_id +'&display=popup&response_type=code%20token&redirect_uri='+ GLOBAL_CONFIG.host +'/'+FB_REDIRECT_URI+'?senderid='+senderID;
		myFunctional.sendTextMessage(req.query.senderid, 'Please wait until we finish authenticate you:-)');
		res.redirect(requestUri);
	});
	
	
	/**
	 * bridge ouath facebook response
	 * this due to remove '#' from url
	 */
	app.get('/'+FB_REDIRECT_URI, function(req, res){
		res.render('bridgeuri', {
			senderID: req.query.senderid
		});
	});
	
	
	/**
	 * handling ouath facebook response from bridge
	 * get information such us FB user Id and salesforce related user information (user id, account id, contanct id)
	 */
	app.get('/fboauthhandler', function(req, res){
		var uri = 'https://graph.facebook.com/debug_token?input_token='+ req.query.access_token +'&access_token='+ GLOBAL_CONFIG.facebook_app.app_id + '|' + GLOBAL_CONFIG.facebook_app.app_secret;
		request(uri, function(err, resp, body){
			if (!err && resp.statusCode == 200) {
				body = JSON.parse(body);
				var senderId = req.query.senderid;
				var FBUserId = body.data.user_id;
				
				org.query({query: "select Id, ContactId, AccountId from User where Fb_Id__c = '" + FBUserId + "'"}, function(errQ, respQ){
					if(errQ){
						console.log(errQ);
						myFunctional.sendTextMessage(req.query.senderid, 'we failed to authenticate you');
					}else{
						if(respQ.records.length > 0){
							respQ.records.forEach(function(data){
								MY_SESSION[senderId] = {
									fb_user_id: FBUserId,
									s_user_id: data.get('Id'),
									s_account_id: data.get('AccountId'),
									s_contact_id: data.get('ContactId'),
									state: '',
									data: {}
								}
							});
							myFunctional.sendTextMessage(req.query.senderid, 'Successfully authenticated you.');
						}else{
							myFunctional.joinMessage(senderId);
						}
					}
					
					res.render('fboauthhandler');
				});
			}else{
				console.error("Failed login to fb", resp.statusCode, resp.statusMessage, body.error);
				myFunctional.sendTextMessage(req.query.senderid, 'we failed to authenticate you');
				res.render('fboauthhandler');
			}
		});
	 });
	 
	
	/**
	 * Use your own validation token. Check that the token used in the Webhook 
	 * setup is the same token used here.
	 *
	 */
	app.get('/webhook', function(req, res) {
		if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === GLOBAL_CONFIG.facebook_app.webhook_validation_token) {
			console.log("Validating webhook");
			res.status(200).send(req.query['hub.challenge']);
		} else {
			console.error("Failed validation. Make sure the validation tokens match.");
			res.sendStatus(403);          
		}  
	});
	
	
	/**
	 * All callbacks for Messenger are POST-ed. They will be sent to the same
	 * webhook. Be sure to subscribe your app to your page to receive callbacks
	 * for your page. 
	 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
	 *
	 */
	app.post('/webhook', function (req, res) {
		
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
						myFunctional.receivedMessage(org, messagingEvent, req);
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
	
	
	/**
	 * configure response
	 */
	app.get('/response_configuration', function(req, res){
		var collection = db.collection('response_configuration');
		collection.findOne({},function(err, data){
			if(data){
				console.log('data');
				console.log(data.item);
			
				res.render('response_configuration', {
					configuration: data.item,
					error_message: ''
				});
			}else{
				res.render('response_configuration', {
					configuration:[],
					error_message: 'failed load configuration'
				});
			}
		});
	});
	
	
	app.post('/response_configuration', function(req, res){
		//strip empty data
		req.body.item.forEach(function(o1, i1){
			var s = -1;
			o1.requests.forEach(function(o2, i2){
				if(o2 == ""){
					s = i2;
				}
			});
			if(s != -1)
				o1.requests.splice(s, 1);
			
			s = -1;
			o1.responses.forEach(function(o2, i2){
				if(o2.type == ""){
					s = i2;
				}
			});
			if(s != -1)
				o1.responses.splice(s, 1);
		});
		
		var collection = db.collection('response_configuration');
		collection.remove({}, function(err, result){
			if(!err){
				collection.insert(req.body, {w:1}, function(errInsert, resultInsert){
					if(errInsert){
						res.render('response_configuration', {
							configuration: req.body.item,
							error_message: 'failed save configuration'
						});
					}else{
						res.render('response_configuration', {
							configuration:req.body.item,
							error_message: ''
						});
					}
				});
			}
		});
	});
};