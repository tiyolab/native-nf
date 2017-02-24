
exports.handleRequest = (app, db) => {
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var configuration = db.app_configuration.findOne({
			app_name: req.header.host
		});
		console.log(req.header.host);
		console.log(conviguration);
		res.render('configure');
	});
	
}