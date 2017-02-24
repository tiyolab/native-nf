
exports.handleRequest(app) => {
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		res.render('configure');
	});
}