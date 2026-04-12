FROM python:3.12-slim

WORKDIR /app

COPY mcp/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY mcp ./mcp
COPY backend/.env ./backend/.env

ENV MCP_TRANSPORT=http
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8000
ENV MCP_PATH=/mcp
ENV FASTMCP_STATELESS_HTTP=true

EXPOSE 8000

CMD ["python", "mcp/mcpserver.py", "--transport", "http", "--host", "0.0.0.0", "--path", "/mcp", "--stateless-http"]
