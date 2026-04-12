FROM python:3.12-slim

WORKDIR /app

COPY mcp/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY mcp ./mcp
COPY backend/.env ./backend/.env

ENV MCP_TRANSPORT=streamable-http
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8000
ENV MCP_PATH=/mcp

EXPOSE 8000

CMD ["python", "mcp/mcpserver.py", "--transport", "streamable-http", "--host", "0.0.0.0", "--path", "/mcp"]
