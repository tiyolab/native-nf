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
				calback(item);
			}else{
				console.log('ERR: configuration not exists, configure by access /configure');
				calback(null);
				return;
			}
		}
	});
}

/**
 ****CONFIG MODEL****
{
	app_name : "",
	host: "",
	status_record: "", //old
	my_app_name: "", //key to search
	salesforce_app: {
		consumer_key: "",
		consumer_secret: "",
		username: "",
		password: ""
	},
	facebook_app:{
		app_name: "",
		app_id: "",
		app_secret: "",
		webhook_validation_token: "",
		page_name: "",
		page_access_token: "",
	}
}

*/