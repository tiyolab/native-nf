"use strict";

let os = require('os');
let _package = require('../package.json');
	
exports.configure = (db, calback) => {
	var collection = db.collection('app_configuration');
	collection.findOne({
		my_app_name: _package.name
	}, function(err, item){
		if(err){
			console.log('ERR: cannot load configuration');
			calback(null);
			return;
		}else{
			if(item){
				item.host = 'https://' + item.host + '/';
				calback(item);
			}else{
				console.log('ERR: configuration not exists, configure by access /configure');
				calback(null);
				return;
			}
		}
	});
}

/*exports.APP_NAME = app_name;
exports.SERVER_URL = 'https://' + host + '/';
exports.SF_CONSUMER_KEY = sf_consumer_key;
exports.SF_CONSUMER_SECRET = sf_consumer_secret;
exports.SF_CONSUMER_USERNAME = sf_username;
exports.SF_CONSUMER_PASSWORD = sf_password;
exports.FB_APP_NAME = fb_app_name;
exports.FB_APP_ID = fb_app_id;
exports.FB_APP_SECRET = fb_app_secret;
exports.FB_WEBHOOK_VALIDATION_TOKEN = fb_webhook_validation_token;
exports.FB_PAGE_NAME = fb_page_name;
exports.FB_PAGE_ACCESS_TOKEN = fb_page_access_token;*/