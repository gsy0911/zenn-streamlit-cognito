.PHONY: help
help: ## show commands ## make
	@printf "\033[36m%-30s\033[0m %-50s %s\n" "[Sub command]" "[Description]" "[Example]"
	@grep -E '^[/a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | perl -pe 's%^([/a-zA-Z_-]+):.*?(##)%$$1 $$2%' | awk -F " *?## *?" '{printf "\033[36m%-30s\033[0m %-50s %s\n", $$1, $$2, $$3}'


.PHONY: build
build: ## build image ## make build
	@docker build -t python/streamlit .


.PHONY: start
start: ## start local ## make start
	@docker run -p 80:80 -it python/streamlit streamlit run app.py
